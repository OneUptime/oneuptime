import {
  HOST_ID_COLUMNS_WITHOUT_FOREIGN_KEY,
  HOST_TABLE_MERGES,
  MergeDuplicateHostsAndAddUniqueHostIdentifier1806700000000,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1806700000000-MergeDuplicateHostsAndAddUniqueHostIdentifier";
import DuplicateRowMerge, {
  ColumnWithoutForeignKey,
  ColumnsTakenTogether,
  DuplicateRowMergeOptions,
  DuplicateRowMergeResult,
} from "../../../../Server/Infrastructure/Postgres/DuplicateRowMerge";
import ObjectID from "../../../../Types/ObjectID";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

/*
 * MergeDuplicateHostsAndAddUniqueHostIdentifier on a real, migrated Postgres
 * (issue #5214): a project's duplicate Docker hosts, Podman hosts and hosts -
 * the ones two batches meeting a new host at once used to create - are
 * merged into the oldest, with every row that refers to them, and the unique
 * index that stops them from now on is built.
 *
 * The children are read from the catalog, not listed here: every table with
 * a foreign key to a host table gets rows referring to the duplicates - and,
 * where a unique index over the reference makes two rows twins (a label, an
 * owner, an incident link, a container), the kept host gets the twin too, so
 * the merge must drop the duplicate's copy rather than fail; and where other
 * tables refer to such a twin (an incident's link to a container), that link
 * must end up on the kept host's copy. So a table added by any later
 * migration is covered the day it exists.
 *
 * Opt in with RUN_POSTGRES_MERGE_DUPLICATE_HOSTS_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database right after its drift check. The tables' STRUCTURE (with their
 * foreign keys among themselves) is cloned into a unique schema, dropped
 * afterwards; every row is synthetic. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from MERGE_DUPLICATE_HOSTS_TEST_DATABASE_NAME
 * or DATABASE_NAME, endpoint from MERGE_DUPLICATE_HOSTS_TEST_DATABASE_HOST /
 * _PORT (default localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_MERGE_DUPLICATE_HOSTS_TESTS"] === "true"
    ? describe
    : describe.skip;

const DASHES: RegExp = /-/g;

const HOST_TABLES: Array<string> = ["DockerHost", "PodmanHost", "Host"];

const UNIQUE_INDEX_OF: Record<string, string> = {
  DockerHost: "IDX_docker_host_project_lower_host_identifier",
  PodmanHost: "IDX_podman_host_project_lower_host_identifier",
  Host: "IDX_host_project_lower_host_identifier",
};

const EARLY: string = "2026-01-01T00:00:00.000Z";

interface Reference {
  table: string;
  column: string;
}

interface UniqueIndex {
  name: string;
  columns: Array<string>;
}

interface ColumnInfo {
  name: string;
  udt: string;
  required: boolean;
  // The width of a bounded text column; null for any other.
  maxLength: number | null;
}

// One host table's seeded group and what refers to it.
interface HostFixture {
  table: string;
  projectId: string;
  otherProjectId: string;
  keptId: string;
  duplicateIds: Array<string>;
  // Rows that must be left alone.
  unrelatedId: string;
  otherProjectId_hostId: string;
  deletedTwinId: string;
  /*
   * Two more groups with nothing referring to them: one whose kept host's
   * own are what is wanted (left on the list, AI an operator chose), one
   * whose every copy was archived.
   */
  ownSettings: { keptId: string; duplicateId: string };
  allArchived: { keptId: string; duplicateId: string; archivedBy: string };
  // Two copies with AI settings chosen, the kept host none: seen last wins.
  aiSeenLast: { keptId: string };
  // Per referring table.column: the rows seeded, by what they must become.
  movedRows: Map<string, Array<string>>;
  twinRows: Map<string, { keptTwin: string; droppedTwins: Array<string> }>;
  // A row referring to a dropped twin, and the kept twin it must refer to.
  grandchildren: Array<{
    reference: Reference;
    rowId: string;
    keptTwinId: string;
    twinTable: string;
  }>;
}

describePostgres(
  "MergeDuplicateHostsAndAddUniqueHostIdentifier against Postgres",
  () => {
    const schema: string = `merge_dup_hosts_${ObjectID.generate()
      .toString()
      .replace(DASHES, "")}`;
    let database: DataSource;
    let cloned: Array<string> = [];

    const columnsOf: Map<string, Array<ColumnInfo>> = new Map();
    const fixtures: Map<string, HostFixture> = new Map();

    function quoted(table: string): string {
      return `"${schema}"."${table}"`;
    }

    async function referencesTo(table: string): Promise<Array<Reference>> {
      return await database.query(
        `SELECT child.relname AS "table", a.attname AS "column"
           FROM pg_constraint c
           JOIN pg_class child ON child.oid = c.conrelid
           JOIN pg_namespace n ON n.oid = child.relnamespace
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
          WHERE c.contype = 'f' AND n.nspname = $1
            AND c.confrelid = $2::regclass
            AND array_length(c.conkey, 1) = 1
          ORDER BY 1, 2`,
        [schema, `"${schema}"."${table}"`],
      );
    }

    async function publicReferencesTo(
      table: string,
    ): Promise<Array<Reference>> {
      return await database.query(
        `SELECT child.relname AS "table", a.attname AS "column"
           FROM pg_constraint c
           JOIN pg_class child ON child.oid = c.conrelid
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
          WHERE c.contype = 'f'
            AND c.confrelid = $1::regclass
            AND array_length(c.conkey, 1) = 1
          ORDER BY 1, 2`,
        [`public."${table}"`],
      );
    }

    async function uniqueIndexesOf(table: string): Promise<Array<UniqueIndex>> {
      return await database.query(
        `SELECT i.indexrelid::regclass::text AS "name",
                ARRAY(
                  SELECT a.attname::text
                    FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, position)
                    JOIN pg_attribute a
                      ON a.attrelid = i.indrelid AND a.attnum = k.attnum
                   ORDER BY k.position
                ) AS "columns"
           FROM pg_index i
          WHERE i.indrelid = $1::regclass AND i.indisunique`,
        [quoted(table)],
      );
    }

    async function hasIdColumn(table: string): Promise<boolean> {
      return (await loadColumns(table)).some((column: ColumnInfo): boolean => {
        return column.name === "_id";
      });
    }

    async function loadColumns(table: string): Promise<Array<ColumnInfo>> {
      const known: Array<ColumnInfo> | undefined = columnsOf.get(table);

      if (known) {
        return known;
      }

      const rows: Array<{
        name: string;
        udt: string;
        nullable: string;
        hasDefault: boolean;
        maxLength: number | null;
      }> = await database.query(
        `SELECT column_name AS "name", udt_name AS "udt", is_nullable AS "nullable",
                column_default IS NOT NULL AS "hasDefault",
                character_maximum_length AS "maxLength"
           FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2`,
        [schema, table],
      );

      const columns: Array<ColumnInfo> = rows.map(
        (row: {
          name: string;
          udt: string;
          nullable: string;
          hasDefault: boolean;
          maxLength: number | null;
        }): ColumnInfo => {
          return {
            name: row.name,
            udt: row.udt,
            required: row.nullable === "NO" && !row.hasDefault,
            maxLength:
              row.maxLength === null || row.maxLength === undefined
                ? null
                : Number(row.maxLength),
          };
        },
      );

      columnsOf.set(table, columns);

      return columns;
    }

    // A value of a column's type that no other row has.
    function uniqueValueOf(column: ColumnInfo): unknown {
      switch (column.udt) {
        case "uuid":
          return ObjectID.generate().toString();
        case "int2":
        case "int4":
        case "int8":
        case "numeric":
        case "float4":
        case "float8":
          return Math.floor(Math.random() * 1_000_000) + 1;
        case "bool":
          return false;
        case "timestamp":
        case "timestamptz":
        case "date":
          return new Date(EARLY);
        case "json":
        case "jsonb":
          return JSON.stringify({});
        default: {
          const unique: string = ObjectID.generate()
            .toString()
            .replace(DASHES, "");

          return column.maxLength !== null && column.maxLength < 60
            ? unique.slice(0, column.maxLength)
            : `${column.name}-${unique}`;
        }
      }
    }

    /*
     * Inserts a row, filling every NOT NULL column without a default that
     * was not given with a value of its type no other row has.
     */
    async function insertRow(
      table: string,
      values: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
      const columns: Array<ColumnInfo> = await loadColumns(table);
      const row: Record<string, unknown> = { ...values };

      if (
        columns.some((column: ColumnInfo): boolean => {
          return column.name === "_id";
        }) &&
        row["_id"] === undefined
      ) {
        row["_id"] = ObjectID.generate().toString();
      }

      for (const column of columns) {
        if (column.required && row[column.name] === undefined) {
          row[column.name] = uniqueValueOf(column);
        }
      }

      const names: Array<string> = Object.keys(row);

      await database.query(
        `INSERT INTO ${quoted(table)} (${names
          .map((name: string): string => {
            return `"${name}"`;
          })
          .join(", ")}) VALUES (${names
          .map((_name: string, index: number): string => {
            return `$${index + 1}`;
          })
          .join(", ")})`,
        names.map((name: string): unknown => {
          return row[name];
        }),
      );

      return row;
    }

    // The values a twin of a row shares with it: the index's other columns.
    async function twinValues(
      reference: Reference,
      index: UniqueIndex,
    ): Promise<Record<string, unknown>> {
      const columns: Array<ColumnInfo> = await loadColumns(reference.table);
      const values: Record<string, unknown> = {};

      for (const name of index.columns) {
        if (name === reference.column) {
          continue;
        }
        const column: ColumnInfo | undefined = columns.find(
          (candidate: ColumnInfo): boolean => {
            return candidate.name === name;
          },
        );
        values[name] = column ? uniqueValueOf(column) : null;
      }

      // A twin is one only among live rows (a partial unique index).
      if (
        columns.some((column: ColumnInfo): boolean => {
          return column.name === "deletedAt";
        })
      ) {
        values["deletedAt"] = null;
      }

      return values;
    }

    async function referencesOfHostTable(
      table: string,
    ): Promise<Array<Reference>> {
      const viaForeignKey: Array<Reference> = await referencesTo(table);
      const withoutForeignKey: Array<Reference> =
        HOST_ID_COLUMNS_WITHOUT_FOREIGN_KEY.map(
          (entry: ColumnWithoutForeignKey): Reference => {
            return { table: entry.table, column: entry.column };
          },
        );

      return [...viaForeignKey, ...withoutForeignKey];
    }

    async function seedHostTable(table: string): Promise<HostFixture> {
      const projectId: string = ObjectID.generate().toString();
      const otherProjectId: string = ObjectID.generate().toString();

      const host: (values: Record<string, unknown>) => Promise<string> = async (
        values: Record<string, unknown>,
      ): Promise<string> => {
        return (await insertRow(table, values))["_id"] as string;
      };

      /*
       * The oldest: what is kept. Never written to by the agent since, and
       * archived - a person hid this copy, not the host. Nobody chose its AI
       * settings: they are the defaults.
       */
      const keptId: string = await host({
        projectId,
        hostIdentifier: "Test01",
        name: "Test01",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        lastSeenAt: new Date("2026-02-01T00:00:00.000Z"),
        otelCollectorStatus: "disconnected",
        agentVersion: "14.0.80",
        description: null,
        // A person set it on this host: it stays, whatever the others say.
        retainTelemetryDataForDays: 90,
        isArchived: true,
        archivedAt: new Date("2026-02-15T00:00:00.000Z"),
        archivedByUserId: ObjectID.generate().toString(),
        aiAccessConfiguredAt: null,
      });

      /*
       * The duplicate the agent kept writing to: on the list, with the AI
       * settings an operator chose for it.
       */
      const liveDuplicateId: string = await host({
        projectId,
        hostIdentifier: "test01",
        name: "test01",
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        lastSeenAt: new Date("2026-03-01T00:00:00.000Z"),
        otelCollectorStatus: "connected",
        agentVersion: "14.0.85",
        description: "edge box in rack 4",
        retainTelemetryDataForDays: 30,
        isArchived: false,
        isAiInvestigationEnabled: false,
        aiRemediationMode: "RequireApproval",
        aiCommandAllowlist: JSON.stringify(["docker restart web"]),
        aiAccessConfiguredAt: new Date("2026-02-20T00:00:00.000Z"),
      });

      // Archived too, with other AI settings, chosen longer ago; never seen.
      const staleDuplicateId: string = await host({
        projectId,
        hostIdentifier: "TEST01",
        name: "TEST01",
        createdAt: new Date("2026-01-03T00:00:00.000Z"),
        lastSeenAt: null,
        otelCollectorStatus: "disconnected",
        description: "another description",
        isArchived: true,
        archivedAt: new Date("2026-02-16T00:00:00.000Z"),
        archivedByUserId: ObjectID.generate().toString(),
        isAiInvestigationEnabled: true,
        aiRemediationMode: "Automatic",
        aiAccessConfiguredAt: new Date("2026-01-10T00:00:00.000Z"),
      });

      /*
       * The kept host's own are what is wanted: it is on the list, and an
       * operator chose its AI settings. Its copy, seen since, says otherwise
       * on both.
       */
      const ownSettings: { keptId: string; duplicateId: string } = {
        keptId: await host({
          projectId,
          hostIdentifier: "test04",
          name: "test04",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          lastSeenAt: new Date("2026-02-01T00:00:00.000Z"),
          isArchived: false,
          isAiInvestigationEnabled: true,
          aiRemediationMode: "Automatic",
          aiAccessConfiguredAt: new Date("2026-01-05T00:00:00.000Z"),
        }),
        duplicateId: await host({
          projectId,
          hostIdentifier: "TEST04",
          name: "TEST04",
          createdAt: new Date("2026-01-02T00:00:00.000Z"),
          lastSeenAt: new Date("2026-03-01T00:00:00.000Z"),
          isArchived: true,
          archivedAt: new Date("2026-02-10T00:00:00.000Z"),
          archivedByUserId: ObjectID.generate().toString(),
          isAiInvestigationEnabled: false,
          aiRemediationMode: "Disabled",
          aiAccessConfiguredAt: new Date("2026-02-12T00:00:00.000Z"),
        }),
      };

      // Every copy archived: the host stays archived, as the kept one was.
      const archivedBy: string = ObjectID.generate().toString();
      const allArchived: {
        keptId: string;
        duplicateId: string;
        archivedBy: string;
      } = {
        keptId: await host({
          projectId,
          hostIdentifier: "test05",
          name: "test05",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          lastSeenAt: new Date("2026-02-01T00:00:00.000Z"),
          isArchived: true,
          archivedAt: new Date("2026-02-01T00:00:00.000Z"),
          archivedByUserId: archivedBy,
          aiAccessConfiguredAt: null,
        }),
        duplicateId: await host({
          projectId,
          hostIdentifier: "Test05",
          name: "Test05",
          createdAt: new Date("2026-01-02T00:00:00.000Z"),
          lastSeenAt: new Date("2026-03-01T00:00:00.000Z"),
          isArchived: true,
          archivedAt: new Date("2026-02-20T00:00:00.000Z"),
          archivedByUserId: ObjectID.generate().toString(),
          aiAccessConfiguredAt: null,
        }),
        archivedBy,
      };

      /*
       * Two copies with AI settings an operator chose, the kept host none:
       * the copy the agent wrote to last gives them, not the copy whose
       * settings were chosen last.
       */
      const aiSeenLast: { keptId: string } = {
        keptId: await host({
          projectId,
          hostIdentifier: "test06",
          name: "test06",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          lastSeenAt: new Date("2026-02-01T00:00:00.000Z"),
          aiAccessConfiguredAt: null,
        }),
      };
      await host({
        projectId,
        hostIdentifier: "TEST06",
        name: "TEST06",
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        lastSeenAt: new Date("2026-03-01T00:00:00.000Z"),
        isAiInvestigationEnabled: false,
        aiRemediationMode: "RequireApproval",
        aiAccessConfiguredAt: new Date("2026-02-25T00:00:00.000Z"),
      });
      await host({
        projectId,
        hostIdentifier: "Test06",
        name: "Test06",
        createdAt: new Date("2026-01-03T00:00:00.000Z"),
        lastSeenAt: new Date("2026-01-20T00:00:00.000Z"),
        isAiInvestigationEnabled: true,
        aiRemediationMode: "BypassApproval",
        aiAccessConfiguredAt: new Date("2026-02-28T00:00:00.000Z"),
      });

      const unrelatedId: string = await host({
        projectId,
        hostIdentifier: "test02",
        name: "test02",
        createdAt: new Date("2025-12-01T00:00:00.000Z"),
      });

      const otherProjectHostId: string = await host({
        projectId: otherProjectId,
        hostIdentifier: "test01",
        name: "test01",
        createdAt: new Date("2025-12-01T00:00:00.000Z"),
      });

      // Deleted (soft): outside the index, never merged.
      const deletedTwinId: string = await host({
        projectId,
        hostIdentifier: "test01",
        name: "test01 (deleted)",
        createdAt: new Date("2025-11-01T00:00:00.000Z"),
        deletedAt: new Date("2025-11-02T00:00:00.000Z"),
      });

      const fixture: HostFixture = {
        table,
        projectId,
        otherProjectId,
        keptId,
        duplicateIds: [liveDuplicateId, staleDuplicateId],
        unrelatedId,
        otherProjectId_hostId: otherProjectHostId,
        deletedTwinId,
        ownSettings,
        allArchived,
        aiSeenLast,
        movedRows: new Map(),
        twinRows: new Map(),
        grandchildren: [],
      };

      for (const reference of await referencesOfHostTable(table)) {
        const label: string = `${reference.table}.${reference.column}`;
        const indexes: Array<UniqueIndex> = (
          await uniqueIndexesOf(reference.table)
        ).filter((index: UniqueIndex): boolean => {
          return index.columns.includes(reference.column);
        });

        // Rows of both duplicates that have no twin: they move.
        const moved: Array<string> = [];
        for (const duplicateId of fixture.duplicateIds) {
          const row: Record<string, unknown> = await insertRow(
            reference.table,
            {
              [reference.column]: duplicateId,
              ...(reference.table === "ResourceAiAgent" ||
              reference.table === "TelemetryException"
                ? { projectId: ObjectID.generate().toString() }
                : {}),
            },
          );
          moved.push(rowKey(reference, row));
        }
        fixture.movedRows.set(label, moved);

        // Rows of the untouched hosts: they stay where they are.
        await insertRow(reference.table, { [reference.column]: unrelatedId });

        // Twins, where a unique index over the reference makes them one.
        for (const index of indexes) {
          const shared: Record<string, unknown> = await twinValues(
            reference,
            index,
          );

          const keptTwin: Record<string, unknown> = await insertRow(
            reference.table,
            { ...shared, [reference.column]: keptId },
          );
          const dropped: Array<Record<string, unknown>> = [];
          for (const duplicateId of fixture.duplicateIds) {
            dropped.push(
              await insertRow(reference.table, {
                ...shared,
                [reference.column]: duplicateId,
              }),
            );
          }

          fixture.twinRows.set(`${label} ${index.name}`, {
            keptTwin: rowKey(reference, keptTwin),
            droppedTwins: dropped.map(
              (row: Record<string, unknown>): string => {
                return rowKey(reference, row);
              },
            ),
          });

          // What refers to a dropped twin goes to the kept one.
          if (
            (await hasIdColumn(reference.table)) &&
            keptTwin["_id"] !== undefined
          ) {
            for (const grandchild of await referencesTo(reference.table)) {
              for (const twin of dropped) {
                const grandchildRow: Record<string, unknown> = await insertRow(
                  grandchild.table,
                  { [grandchild.column]: twin["_id"] },
                );
                fixture.grandchildren.push({
                  reference: grandchild,
                  rowId: rowKey(grandchild, grandchildRow),
                  keptTwinId: keptTwin["_id"] as string,
                  twinTable: reference.table,
                });
              }
            }
          }
        }
      }

      return fixture;
    }

    /*
     * How a seeded row is found again: its _id, or - for a join table with a
     * composite key - its other key columns, which the merge never changes.
     */
    function rowKey(
      reference: Reference,
      row: Record<string, unknown>,
    ): string {
      if (row["_id"] !== undefined) {
        return `_id=${String(row["_id"])}`;
      }

      return Object.entries(row)
        .filter(([name]: [string, unknown]): boolean => {
          return name !== reference.column;
        })
        .sort(([a]: [string, unknown], [b]: [string, unknown]): number => {
          return a.localeCompare(b);
        })
        .map(([name, value]: [string, unknown]): string => {
          return `${name}=${value instanceof Date ? value.toISOString() : String(value)}`;
        })
        .join("&");
    }

    async function referenceOf(
      reference: Reference,
      key: string,
    ): Promise<Array<string>> {
      const conditions: Array<string> = [];
      const values: Array<unknown> = [];

      for (const part of key.split("&")) {
        const separator: number = part.indexOf("=");
        const name: string = part.slice(0, separator);
        const value: string = part.slice(separator + 1);
        values.push(value);
        conditions.push(`"${name}"::text = $${values.length}`);
      }

      const rows: Array<{ ref: string | null }> = await database.query(
        `SELECT "${reference.column}"::text AS "ref" FROM ${quoted(
          reference.table,
        )} WHERE ${conditions.join(" AND ")}`,
        values,
      );

      return rows.map((row: { ref: string | null }): string => {
        return String(row.ref);
      });
    }

    // A host's archived state, its times as ISO text; null when it is gone.
    async function archiveOf(
      table: string,
      id: string,
    ): Promise<{
      isArchived: boolean;
      archivedAt: string | null;
      archivedByUserId: string | null;
    } | null> {
      const rows: Array<{
        isArchived: boolean;
        archivedAt: Date | null;
        archivedByUserId: string | null;
      }> = await database.query(
        `SELECT "isArchived", "archivedAt", "archivedByUserId"::text AS "archivedByUserId"
           FROM ${quoted(table)} WHERE "_id" = $1`,
        [id],
      );

      const row:
        | {
            isArchived: boolean;
            archivedAt: Date | null;
            archivedByUserId: string | null;
          }
        | undefined = rows[0];

      if (!row) {
        return null;
      }

      return {
        isArchived: row.isArchived,
        archivedAt: row.archivedAt
          ? new Date(row.archivedAt).toISOString()
          : null,
        archivedByUserId: row.archivedByUserId,
      };
    }

    // A host's AI settings, the time an operator chose them as ISO text.
    async function aiSettingsOf(
      table: string,
      id: string,
    ): Promise<{
      isAiInvestigationEnabled: boolean;
      aiRemediationMode: string;
      aiCommandAllowlist: unknown;
      aiAccessConfiguredAt: string | null;
    } | null> {
      const rows: Array<{
        isAiInvestigationEnabled: boolean;
        aiRemediationMode: string;
        aiCommandAllowlist: unknown;
        aiAccessConfiguredAt: Date | null;
      }> = await database.query(
        `SELECT "isAiInvestigationEnabled", "aiRemediationMode", "aiCommandAllowlist",
                "aiAccessConfiguredAt"
           FROM ${quoted(table)} WHERE "_id" = $1`,
        [id],
      );

      const row:
        | {
            isAiInvestigationEnabled: boolean;
            aiRemediationMode: string;
            aiCommandAllowlist: unknown;
            aiAccessConfiguredAt: Date | null;
          }
        | undefined = rows[0];

      if (!row) {
        return null;
      }

      return {
        isAiInvestigationEnabled: row.isAiInvestigationEnabled,
        aiRemediationMode: row.aiRemediationMode,
        aiCommandAllowlist: row.aiCommandAllowlist,
        aiAccessConfiguredAt: row.aiAccessConfiguredAt
          ? new Date(row.aiAccessConfiguredAt).toISOString()
          : null,
      };
    }

    async function runMigration(): Promise<void> {
      const queryRunner: QueryRunner = database.createQueryRunner();
      try {
        await queryRunner.query(`SET search_path TO "${schema}"`);
        await new MergeDuplicateHostsAndAddUniqueHostIdentifier1806700000000().up(
          queryRunner,
        );
      } finally {
        await queryRunner.query(`SET search_path TO DEFAULT`);
        await queryRunner.release();
      }
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["MERGE_DUPLICATE_HOSTS_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["MERGE_DUPLICATE_HOSTS_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["MERGE_DUPLICATE_HOSTS_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        schema: schema,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      // The host tables, everything that refers to them, and what refers to that.
      const tables: Set<string> = new Set<string>(HOST_TABLES);
      for (const entry of HOST_ID_COLUMNS_WITHOUT_FOREIGN_KEY) {
        tables.add(entry.table);
      }
      for (const table of HOST_TABLES) {
        for (const reference of await publicReferencesTo(table)) {
          tables.add(reference.table);
        }
      }
      for (const table of Array.from(tables)) {
        if (HOST_TABLES.includes(table)) {
          continue;
        }
        for (const reference of await publicReferencesTo(table)) {
          tables.add(reference.table);
        }
      }

      cloned = Array.from(tables).sort();

      for (const table of cloned) {
        await database.query(
          `CREATE TABLE ${quoted(table)} (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      // Built by the migration under test: start without it.
      const builtAlready: Array<{ name: string }> = await database.query(
        `SELECT indexname AS "name" FROM pg_indexes
          WHERE schemaname = $1 AND indexdef ILIKE '%lower(("hostIdentifier")%'`,
        [schema],
      );
      for (const index of builtAlready) {
        await database.query(`DROP INDEX "${schema}"."${index.name}"`);
      }

      // The foreign keys among the cloned tables, as public has them.
      const foreignKeys: Array<{
        child: string;
        name: string;
        definition: string;
      }> = await database.query(
        `SELECT child.relname AS "child", c.conname AS "name",
                pg_get_constraintdef(c.oid) AS "definition"
           FROM pg_constraint c
           JOIN pg_class child ON child.oid = c.conrelid
           JOIN pg_class parent ON parent.oid = c.confrelid
           JOIN pg_namespace cn ON cn.oid = child.relnamespace
           JOIN pg_namespace pn ON pn.oid = parent.relnamespace
          WHERE c.contype = 'f' AND cn.nspname = 'public' AND pn.nspname = 'public'
            AND child.relname = ANY($1) AND parent.relname = ANY($1)`,
        [cloned],
      );

      /*
       * pg_get_constraintdef names public's table as public."DockerHost" -
       * the clone hides it on this search path - so each key is pointed at
       * the clone it belongs with.
       */
      for (const foreignKey of foreignKeys) {
        const definition: string = foreignKey.definition
          .split("REFERENCES public.")
          .join(`REFERENCES "${schema}".`);

        await database.query(
          `ALTER TABLE ${quoted(foreignKey.child)} ADD CONSTRAINT "${foreignKey.name}" ${definition}`,
        );
      }

      // Every key the clone has refers to a clone: none to public.
      const keysToPublic: Array<{ count: number }> = await database.query(
        `SELECT COUNT(*)::int AS "count"
           FROM pg_constraint c
           JOIN pg_class child ON child.oid = c.conrelid
           JOIN pg_namespace cn ON cn.oid = child.relnamespace
           JOIN pg_class parent ON parent.oid = c.confrelid
           JOIN pg_namespace pn ON pn.oid = parent.relnamespace
          WHERE c.contype = 'f' AND cn.nspname = $1 AND pn.nspname <> $1`,
        [schema],
      );
      expect(keysToPublic[0]!.count).toBe(0);
      expect(foreignKeys.length).toBeGreaterThan(30);

      for (const table of HOST_TABLES) {
        fixtures.set(table, await seedHostTable(table));
      }

      await runMigration();
    }, 600_000);

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    test("the merge reads every host's children from the catalog - the issue's DockerResource among them", async () => {
      const dockerChildren: Array<string> = (
        await referencesTo("DockerHost")
      ).map((reference: Reference): string => {
        return `${reference.table}.${reference.column}`;
      });

      expect(dockerChildren).toEqual(
        expect.arrayContaining([
          "DockerResource.dockerHostId",
          "DockerHostLabel.dockerHostId",
          "DockerHostOwnerUser.dockerHostId",
          "DockerHostOwnerTeam.dockerHostId",
          "DockerHostFeed.dockerHostId",
          "IncidentDockerHost.dockerHostId",
          "AlertDockerHost.dockerHostId",
          "MonitorDockerHost.dockerHostId",
          "Host.dockerHostId",
          "DatabaseServer.dockerHostId",
        ]),
      );
    });

    describe.each(HOST_TABLES)("%s", (table: string) => {
      test("the fixture refers to the duplicates from every child the catalog lists", async () => {
        const fixture: HostFixture = fixtures.get(table)!;
        const references: Array<Reference> = await referencesOfHostTable(table);

        // Every foreign key to the table, and every id column without one.
        expect(references.length).toBeGreaterThanOrEqual(
          HOST_ID_COLUMNS_WITHOUT_FOREIGN_KEY.length + 9,
        );
        expect(fixture.movedRows.size).toBe(references.length);
        // Labels, owners, incident/alert/monitor/maintenance links, AI agent...
        expect(fixture.twinRows.size).toBeGreaterThanOrEqual(10);
      });

      test("one row is left of the group: the oldest", async () => {
        const fixture: HostFixture = fixtures.get(table)!;

        const rows: Array<{ id: string }> = await database.query(
          `SELECT "_id"::text AS "id" FROM ${quoted(table)}
            WHERE "projectId" = $1 AND LOWER("hostIdentifier") = 'test01'
              AND "deletedAt" IS NULL`,
          [fixture.projectId],
        );

        expect(rows).toEqual([{ id: fixture.keptId }]);
      });

      test("the hosts outside the group are left as they were", async () => {
        const fixture: HostFixture = fixtures.get(table)!;

        const rows: Array<{ id: string }> = await database.query(
          `SELECT "_id"::text AS "id" FROM ${quoted(table)} WHERE "_id" = ANY($1::uuid[]) ORDER BY 1`,
          [
            [
              fixture.unrelatedId,
              fixture.otherProjectId_hostId,
              fixture.deletedTwinId,
            ],
          ],
        );

        expect(
          rows
            .map((row: { id: string }): string => {
              return row.id;
            })
            .sort(),
        ).toEqual(
          [
            fixture.unrelatedId,
            fixture.otherProjectId_hostId,
            fixture.deletedTwinId,
          ].sort(),
        );
      });

      test("the kept host takes what the agent last reported and a description it lacked, and keeps its own retention", async () => {
        const fixture: HostFixture = fixtures.get(table)!;

        const rows: Array<{
          lastSeenAt: Date;
          otelCollectorStatus: string;
          agentVersion: string;
          description: string;
          retainTelemetryDataForDays: number;
          hostIdentifier: string;
        }> = await database.query(
          `SELECT "lastSeenAt", "otelCollectorStatus", "agentVersion", "description",
                  "retainTelemetryDataForDays", "hostIdentifier"
             FROM ${quoted(table)} WHERE "_id" = $1`,
          [fixture.keptId],
        );

        expect(rows).toHaveLength(1);
        expect(new Date(rows[0]!.lastSeenAt).toISOString()).toBe(
          "2026-03-01T00:00:00.000Z",
        );
        expect(rows[0]!.otelCollectorStatus).toBe("connected");
        expect(rows[0]!.agentVersion).toBe("14.0.85");
        // It had none; the duplicate seen last had one.
        expect(rows[0]!.description).toBe("edge box in rack 4");
        // Its own, not the 30 days of the duplicate seen last.
        expect(rows[0]!.retainTelemetryDataForDays).toBe(90);
        // What it is found by is its own.
        expect(rows[0]!.hostIdentifier).toBe("Test01");
      });

      test("a copy left on the list keeps the host there: it stays archived only if every copy was", async () => {
        const fixture: HostFixture = fixtures.get(table)!;

        // The kept copy was archived, the one the agent wrote to was not.
        expect(await archiveOf(table, fixture.keptId)).toEqual({
          isArchived: false,
          archivedAt: null,
          archivedByUserId: null,
        });

        // On the list already: it stays, whatever its archived copy said.
        expect(await archiveOf(table, fixture.ownSettings.keptId)).toEqual({
          isArchived: false,
          archivedAt: null,
          archivedByUserId: null,
        });
        expect(await archiveOf(table, fixture.ownSettings.duplicateId)).toBe(
          null,
        );

        // Every copy archived: archived, when and by whom the kept one was.
        expect(await archiveOf(table, fixture.allArchived.keptId)).toEqual({
          isArchived: true,
          archivedAt: "2026-02-01T00:00:00.000Z",
          archivedByUserId: fixture.allArchived.archivedBy,
        });
        expect(await archiveOf(table, fixture.allArchived.duplicateId)).toBe(
          null,
        );
      });

      test("the AI settings an operator chose for a copy are kept where none were chosen for the kept host - and its own choice wins", async () => {
        const fixture: HostFixture = fixtures.get(table)!;

        // None chosen for it: the copy seen last that has some gives them, all.
        expect(await aiSettingsOf(table, fixture.keptId)).toEqual({
          isAiInvestigationEnabled: false,
          aiRemediationMode: "RequireApproval",
          aiCommandAllowlist: ["docker restart web"],
          aiAccessConfiguredAt: "2026-02-20T00:00:00.000Z",
        });

        // Chosen for it: its own, whatever its copy said since.
        expect(await aiSettingsOf(table, fixture.ownSettings.keptId)).toEqual({
          isAiInvestigationEnabled: true,
          aiRemediationMode: "Automatic",
          aiCommandAllowlist: null,
          aiAccessConfiguredAt: "2026-01-05T00:00:00.000Z",
        });

        // Chosen for two copies: the one seen last gives them.
        expect(await aiSettingsOf(table, fixture.aiSeenLast.keptId)).toEqual({
          isAiInvestigationEnabled: false,
          aiRemediationMode: "RequireApproval",
          aiCommandAllowlist: null,
          aiAccessConfiguredAt: "2026-02-25T00:00:00.000Z",
        });

        // Chosen for none: the defaults stay.
        expect(await aiSettingsOf(table, fixture.allArchived.keptId)).toEqual({
          isAiInvestigationEnabled: true,
          aiRemediationMode: "Disabled",
          aiCommandAllowlist: null,
          aiAccessConfiguredAt: null,
        });
      });

      test("every row that referred to a duplicate refers to the kept host", async () => {
        const fixture: HostFixture = fixtures.get(table)!;

        for (const reference of await referencesOfHostTable(table)) {
          const leftOnDuplicates: Array<{ count: number }> =
            await database.query(
              `SELECT COUNT(*)::int AS "count" FROM ${quoted(reference.table)}
                WHERE "${reference.column}" = ANY($1::uuid[])`,
              [fixture.duplicateIds],
            );

          expect([reference, leftOnDuplicates[0]!.count]).toEqual([
            reference,
            0,
          ]);

          for (const key of fixture.movedRows.get(
            `${reference.table}.${reference.column}`,
          ) || []) {
            expect([reference, key, await referenceOf(reference, key)]).toEqual(
              [reference, key, [fixture.keptId]],
            );
          }
        }
      });

      test("where the kept host already had a row's twin, the twin stays and the duplicates' copies go", async () => {
        const fixture: HostFixture = fixtures.get(table)!;

        expect(fixture.twinRows.size).toBeGreaterThan(0);

        for (const [label, twins] of fixture.twinRows.entries()) {
          const reference: Reference = {
            table: label.split(".")[0]!,
            column: label.split(".")[1]!.split(" ")[0]!,
          };

          expect([label, await referenceOf(reference, twins.keptTwin)]).toEqual(
            [label, [fixture.keptId]],
          );

          for (const dropped of twins.droppedTwins) {
            if (dropped.startsWith("_id=")) {
              expect([label, await referenceOf(reference, dropped)]).toEqual([
                label,
                [],
              ]);
            } else {
              // A join row: its twin is the kept one, the only row left.
              expect([label, await referenceOf(reference, dropped)]).toEqual([
                label,
                [fixture.keptId],
              ]);
            }
          }
        }
      });

      test("what referred to a dropped twin refers to the kept twin - an incident's link to a container both hosts listed", async () => {
        const fixture: HostFixture = fixtures.get(table)!;

        for (const grandchild of fixture.grandchildren) {
          /*
           * Each seeded link names an incident (or alert) of its own, so none
           * is a twin of another: every one is still there, on the kept
           * container - none went with the dropped one's cascade.
           */
          expect([
            grandchild.reference.table,
            await referenceOf(grandchild.reference, grandchild.rowId),
          ]).toEqual([grandchild.reference.table, [grandchild.keptTwinId]]);
        }

        if (table === "DockerHost") {
          expect(
            fixture.grandchildren.map(
              (grandchild: {
                reference: Reference;
                twinTable: string;
              }): string => {
                return `${grandchild.twinTable}<-${grandchild.reference.table}`;
              },
            ),
          ).toEqual(
            expect.arrayContaining([
              "DockerResource<-IncidentDockerResource",
              "DockerResource<-AlertDockerResource",
            ]),
          );
        }
      });

      test("the unique index is built online and valid, and refuses a second host of the name in any case", async () => {
        const fixture: HostFixture = fixtures.get(table)!;

        const indexes: Array<{ valid: boolean; definition: string }> =
          await database.query(
            `SELECT x.indisvalid AS "valid", pg_get_indexdef(x.indexrelid) AS "definition"
               FROM pg_index x JOIN pg_class c ON c.oid = x.indexrelid
              WHERE x.indrelid = $1::regclass AND c.relname = $2`,
            [quoted(table), UNIQUE_INDEX_OF[table]],
          );

        expect(indexes).toHaveLength(1);
        expect(indexes[0]!.valid).toBe(true);
        expect(indexes[0]!.definition).toContain("UNIQUE");
        expect(indexes[0]!.definition).toContain(
          `("projectId", lower(("hostIdentifier")::text))`,
        );
        expect(indexes[0]!.definition).toContain(`WHERE ("deletedAt" IS NULL)`);

        await expect(
          insertRow(table, {
            projectId: fixture.projectId,
            hostIdentifier: "tEsT01",
          }),
        ).rejects.toMatchObject({ code: "23505" });

        await expect(
          insertRow(table, {
            projectId: fixture.otherProjectId,
            hostIdentifier: "TEST01",
          }),
        ).rejects.toMatchObject({ code: "23505" });

        // Another name, and a deleted row of this one, are not refused.
        await expect(
          insertRow(table, {
            projectId: fixture.projectId,
            hostIdentifier: "test03",
          }),
        ).resolves.toBeDefined();
        await expect(
          insertRow(table, {
            projectId: fixture.projectId,
            hostIdentifier: "test01",
            deletedAt: new Date(),
          }),
        ).resolves.toBeDefined();
      });
    });

    test("run again, it changes nothing - merged groups are gone and a valid index stays", async () => {
      const before: Array<{ table: string; count: number }> = [];
      for (const table of cloned) {
        const rows: Array<{ count: number }> = await database.query(
          `SELECT COUNT(*)::int AS "count" FROM ${quoted(table)}`,
        );
        before.push({ table, count: rows[0]!.count });
      }

      await runMigration();

      for (const entry of before) {
        const rows: Array<{ count: number }> = await database.query(
          `SELECT COUNT(*)::int AS "count" FROM ${quoted(entry.table)}`,
        );
        expect([entry.table, rows[0]!.count]).toEqual([
          entry.table,
          entry.count,
        ]);
      }
    });

    test("the merge options name columns every host table has", async () => {
      for (const merge of HOST_TABLE_MERGES) {
        const columns: Array<string> = (await loadColumns(merge.table)).map(
          (column: ColumnInfo): string => {
            return column.name;
          },
        );

        for (const column of [
          ...merge.latestOf,
          ...merge.keptOrFirstOf,
          ...(merge.takenTogether || []).flatMap(
            (together: ColumnsTakenTogether): ReadonlyArray<string> => {
              return together.columns;
            },
          ),
          merge.latestBy,
        ]) {
          expect([merge.table, column, columns.includes(column)]).toEqual([
            merge.table,
            column,
            true,
          ]);
        }
      }

      for (const entry of HOST_ID_COLUMNS_WITHOUT_FOREIGN_KEY) {
        const columns: Array<string> = (await loadColumns(entry.table)).map(
          (column: ColumnInfo): string => {
            return column.name;
          },
        );
        expect([entry.table, columns.includes(entry.column)]).toEqual([
          entry.table,
          true,
        ]);
      }
    });
  },
);

/*
 * DuplicateRowMerge, rule by rule, on tables made for each rule it reads from
 * the catalog. No table that refers to a host has these indexes today, so the
 * migration's run above cannot show them: a unique index on live rows only
 * (a deleted row is nobody's twin - it moves), one whose NULLs are equal
 * (NULLS NOT DISTINCT - a NULL is a twin of a NULL), and ones it cannot read
 * (over an expression, or WHERE anything but "deletedAt" IS NULL): it stops
 * with the index's name and leaves the group as it was. What the kept row
 * takes is shown both ways: what the agent reports from the row seen last,
 * what a person set kept where the kept row has it.
 */
describePostgres("DuplicateRowMerge against Postgres, rule by rule", () => {
  const schema: string = `merge_rules_${ObjectID.generate()
    .toString()
    .replace(DASHES, "")}`;
  let database: DataSource;
  let boxResult: DuplicateRowMergeResult;

  const ids: Record<string, string> = {};

  function optionsFor(table: string): DuplicateRowMergeOptions {
    return {
      table: table,
      duplicateKey: `"projectId", LOWER("name")`,
      where: `"deletedAt" IS NULL`,
      columnsWithoutForeignKey: [],
      latestOf: ["status"],
      keptOrFirstOf: ["note"],
      latestBy: "lastSeenAt",
    };
  }

  async function merge(table: string): Promise<DuplicateRowMergeResult> {
    const queryRunner: QueryRunner = database.createQueryRunner();
    try {
      await queryRunner.query(`SET search_path TO "${schema}"`);
      return await DuplicateRowMerge.merge(queryRunner, optionsFor(table));
    } finally {
      await queryRunner.query(`SET search_path TO DEFAULT`);
      await queryRunner.release();
    }
  }

  // A table merged by name, like the host tables.
  async function createParent(table: string): Promise<void> {
    await database.query(
      `CREATE TABLE "${schema}"."${table}" (
         "_id" uuid PRIMARY KEY,
         "projectId" uuid NOT NULL,
         "name" varchar(100) NOT NULL,
         "createdAt" timestamptz NOT NULL,
         "lastSeenAt" timestamptz NULL,
         "deletedAt" timestamptz NULL,
         "status" varchar(100) NULL,
         "note" varchar(100) NULL
       )`,
    );
  }

  /*
   * A table referring to `parent` - without ON DELETE CASCADE, so a row the
   * merge failed to move would stop the duplicate's delete rather than go
   * with it.
   */
  async function createChild(
    table: string,
    parent: string,
    column: string,
    valueColumn: string,
  ): Promise<void> {
    await database.query(
      `CREATE TABLE "${schema}"."${table}" (
         "_id" uuid PRIMARY KEY,
         "${column}" uuid NOT NULL REFERENCES "${schema}"."${parent}" ("_id"),
         "${valueColumn}" varchar(100) NULL,
         "deletedAt" timestamptz NULL
       )`,
    );
  }

  async function insertParent(
    table: string,
    name: string,
    values: {
      projectId: string;
      createdAt: string;
      lastSeenAt: string;
      status: string;
      note: string | null;
    },
  ): Promise<string> {
    const id: string = ObjectID.generate().toString();
    await database.query(
      `INSERT INTO "${schema}"."${table}"
         ("_id", "projectId", "name", "createdAt", "lastSeenAt", "status", "note")
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        values.projectId,
        name,
        values.createdAt,
        values.lastSeenAt,
        values.status,
        values.note,
      ],
    );
    return id;
  }

  async function insertChild(
    table: string,
    column: string,
    valueColumn: string,
    parentId: string,
    value: string | null,
    deletedAt: string | null = null,
  ): Promise<string> {
    const id: string = ObjectID.generate().toString();
    await database.query(
      `INSERT INTO "${schema}"."${table}" ("_id", "${column}", "${valueColumn}", "deletedAt")
       VALUES ($1, $2, $3, $4)`,
      [id, parentId, value, deletedAt],
    );
    return id;
  }

  // The parent a child row refers to now; null when the row is gone.
  async function parentOf(
    table: string,
    column: string,
    id: string,
  ): Promise<string | null> {
    const rows: Array<{ parent: string }> = await database.query(
      `SELECT "${column}"::text AS "parent" FROM "${schema}"."${table}" WHERE "_id" = $1`,
      [id],
    );
    return rows[0]?.parent ?? null;
  }

  async function parentRow(
    table: string,
    id: string,
  ): Promise<{ status: string; note: string | null } | null> {
    const rows: Array<{ status: string; note: string | null }> =
      await database.query(
        `SELECT "status", "note" FROM "${schema}"."${table}" WHERE "_id" = $1`,
        [id],
      );
    return rows[0] ?? null;
  }

  // Two of one thing in a project: the oldest is kept, the other seen last.
  async function seedPair(
    table: string,
    names: [string, string],
    keptNote: string | null,
  ): Promise<{ keptId: string; duplicateId: string }> {
    const projectId: string = ObjectID.generate().toString();

    const keptId: string = await insertParent(table, names[0], {
      projectId,
      createdAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-02-01T00:00:00.000Z",
      status: "disconnected",
      note: keptNote,
    });
    const duplicateId: string = await insertParent(table, names[1], {
      projectId,
      createdAt: "2026-01-02T00:00:00.000Z",
      lastSeenAt: "2026-03-01T00:00:00.000Z",
      status: "connected",
      note: "the duplicate's note",
    });

    return { keptId, duplicateId };
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["MERGE_DUPLICATE_HOSTS_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["MERGE_DUPLICATE_HOSTS_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["MERGE_DUPLICATE_HOSTS_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      schema: schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    // Box: a part per name among live parts; a tag per value, NULL included.
    await createParent("Box");
    await createChild("BoxPart", "Box", "boxId", "name");
    await database.query(
      `CREATE UNIQUE INDEX "IDX_box_part_live_name" ON "${schema}"."BoxPart" ("boxId", "name") WHERE "deletedAt" IS NULL`,
    );
    await createChild("BoxTag", "Box", "boxId", "tag");
    await database.query(
      `CREATE UNIQUE INDEX "IDX_box_tag" ON "${schema}"."BoxTag" ("boxId", "tag") NULLS NOT DISTINCT`,
    );

    // Crate: a label per name in any case - an expression.
    await createParent("Crate");
    await createChild("CrateLabel", "Crate", "crateId", "name");
    await database.query(
      `CREATE UNIQUE INDEX "IDX_crate_label_lower_name" ON "${schema}"."CrateLabel" ("crateId", LOWER("name"))`,
    );

    // Bin: a part per name among parts that have one - another predicate.
    await createParent("Bin");
    await createChild("BinPart", "Bin", "binId", "name");
    await database.query(
      `CREATE UNIQUE INDEX "IDX_bin_part_named" ON "${schema}"."BinPart" ("binId", "name") WHERE "name" <> ''`,
    );

    // Boxes with parts: a live eth0 each; the duplicate's deleted eth0 and its eth1.
    const parts: { keptId: string; duplicateId: string } = await seedPair(
      "Box",
      ["Edge", "EDGE"],
      "the kept note",
    );
    ids["partsKept"] = parts.keptId;
    ids["partsDuplicate"] = parts.duplicateId;
    ids["keptLivePart"] = await insertChild(
      "BoxPart",
      "boxId",
      "name",
      parts.keptId,
      "eth0",
    );
    ids["duplicateLiveTwin"] = await insertChild(
      "BoxPart",
      "boxId",
      "name",
      parts.duplicateId,
      "eth0",
    );
    ids["duplicateDeletedPart"] = await insertChild(
      "BoxPart",
      "boxId",
      "name",
      parts.duplicateId,
      "eth0",
      "2026-02-15T00:00:00.000Z",
    );
    ids["duplicateOtherPart"] = await insertChild(
      "BoxPart",
      "boxId",
      "name",
      parts.duplicateId,
      "eth1",
    );

    // Boxes with tags: each has the NULL tag, the duplicate a named one too.
    const tags: { keptId: string; duplicateId: string } = await seedPair(
      "Box",
      ["core", "Core"],
      null,
    );
    ids["tagsKept"] = tags.keptId;
    ids["tagsDuplicate"] = tags.duplicateId;
    ids["keptNullTag"] = await insertChild(
      "BoxTag",
      "boxId",
      "tag",
      tags.keptId,
      null,
    );
    ids["duplicateNullTag"] = await insertChild(
      "BoxTag",
      "boxId",
      "tag",
      tags.duplicateId,
      null,
    );
    ids["duplicateNamedTag"] = await insertChild(
      "BoxTag",
      "boxId",
      "tag",
      tags.duplicateId,
      "rack-4",
    );

    boxResult = await merge("Box");
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  test("both pairs merge into their oldest: the duplicates are gone", async () => {
    expect(boxResult).toEqual({
      groupsMerged: 2,
      rowsMerged: 2,
      // The deleted eth0 and eth1 parts, and the rack-4 tag.
      referencesMoved: 3,
      // The duplicate's live eth0 part and its NULL tag.
      twinsDropped: 2,
    });

    expect(await parentRow("Box", ids["partsDuplicate"]!)).toBeNull();
    expect(await parentRow("Box", ids["tagsDuplicate"]!)).toBeNull();
  });

  test("the kept row takes what the agent reports from the row seen last, and keeps what a person set", async () => {
    expect(await parentRow("Box", ids["partsKept"]!)).toEqual({
      status: "connected",
      note: "the kept note",
    });
  });

  test("where the kept row has nothing a person set, it takes what the row seen last had", async () => {
    expect(await parentRow("Box", ids["tagsKept"]!)).toEqual({
      status: "connected",
      note: "the duplicate's note",
    });
  });

  test("under a unique index on live rows only, a deleted row is nobody's twin: it moves, and only the live twin goes", async () => {
    expect(await parentOf("BoxPart", "boxId", ids["keptLivePart"]!)).toBe(
      ids["partsKept"],
    );
    expect(
      await parentOf("BoxPart", "boxId", ids["duplicateLiveTwin"]!),
    ).toBeNull();
    expect(
      await parentOf("BoxPart", "boxId", ids["duplicateDeletedPart"]!),
    ).toBe(ids["partsKept"]);
    expect(await parentOf("BoxPart", "boxId", ids["duplicateOtherPart"]!)).toBe(
      ids["partsKept"],
    );
  });

  test("under NULLS NOT DISTINCT, a NULL is the twin of a NULL: the duplicate's goes, its named tag moves", async () => {
    expect(await parentOf("BoxTag", "boxId", ids["keptNullTag"]!)).toBe(
      ids["tagsKept"],
    );
    expect(
      await parentOf("BoxTag", "boxId", ids["duplicateNullTag"]!),
    ).toBeNull();
    expect(await parentOf("BoxTag", "boxId", ids["duplicateNamedTag"]!)).toBe(
      ids["tagsKept"],
    );
  });

  test.each([
    ["Crate", "CrateLabel", "crateId", "IDX_crate_label_lower_name"],
    ["Bin", "BinPart", "binId", "IDX_bin_part_named"],
  ])(
    "%s: a unique index it cannot read stops the merge with its name, and the group is left as it was",
    async (table: string, child: string, column: string, index: string) => {
      const pair: { keptId: string; duplicateId: string } = await seedPair(
        table,
        ["Shelf", "SHELF"],
        null,
      );
      const childId: string = await insertChild(
        child,
        column,
        "name",
        pair.duplicateId,
        "a",
      );

      await expect(merge(table)).rejects.toThrow(index);

      // Rolled back: both rows, the kept one unchanged, the child where it was.
      expect(await parentRow(table, pair.keptId)).toEqual({
        status: "disconnected",
        note: null,
      });
      expect(await parentRow(table, pair.duplicateId)).not.toBeNull();
      expect(await parentOf(child, column, childId)).toBe(pair.duplicateId);
    },
  );
});
