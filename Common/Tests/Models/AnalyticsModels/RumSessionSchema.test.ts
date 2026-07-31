import { ClickhouseAppInstance } from "../../../Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "../../../Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import "../../Server/TestingUtils/Init";
import AnalyticsModels from "../../../Models/AnalyticsModels/Index";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsTableColumn from "../../../Types/AnalyticsDatabase/TableColumn";
import AnalyticsTableEngine from "../../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import Permission from "../../../Types/Permission";
import RumSession from "../../../Models/AnalyticsModels/RumSession";
import RumSessionChunk from "../../../Models/AnalyticsModels/RumSessionChunk";

/*
 * These assertions guard decisions that CANNOT be changed after the first
 * deploy.
 *
 * Boot-time schema reconciliation in this repo is purely additive: it runs
 * ADD COLUMN IF NOT EXISTS and CREATE TABLE IF NOT EXISTS, and nothing ever
 * issues MODIFY ORDER BY, MODIFY TTL, or a partition-key change. So getting
 * the sort key, partition key, TTL or table settings wrong here means a
 * drop-and-recreate on what will be the largest table in the system.
 *
 * Each test below therefore states WHY the value matters, not just what it is.
 */

function fullText(statement: Statement | string): string {
  if (typeof statement === "string") {
    return statement;
  }
  return statement.query + " :: " + JSON.stringify(statement.query_params);
}

function createStatementFor(modelType: { new (): AnalyticsBaseModel }): string {
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: modelType,
      database: ClickhouseAppInstance,
    });

  return fullText(generator.toTableCreateStatement());
}

function columnKeys(model: AnalyticsBaseModel): Array<string> {
  return model.tableColumns.map((column: AnalyticsTableColumn): string => {
    return column.key;
  });
}

function findColumn(
  model: AnalyticsBaseModel,
  key: string,
): AnalyticsTableColumn | undefined {
  return model.tableColumns.find((column: AnalyticsTableColumn): boolean => {
    return column.key === key;
  });
}

describe("Session replay ClickHouse schema", () => {
  describe("RumSession (header table)", () => {
    const model: RumSession = new RumSession();

    it("is named RumSessionV1", () => {
      expect(model.tableName).toBe(AnalyticsTableName.RumSession);
      expect(model.tableName).toBe("RumSessionV1");
    });

    it("uses ReplacingMergeTree and therefore MUST have a column named exactly 'version'", () => {
      /*
       * ClusterConfig.getStorageEngine hardcodes the version column NAME
       * when it builds ReplicatedReplacingMergeTree(version). A column
       * named anything else produces a table that will not create.
       */
      expect(model.tableEngine).toBe(AnalyticsTableEngine.ReplacingMergeTree);
      expect(columnKeys(model)).toContain("version");
    });

    it("orders by (projectId, rumApplicationId, startTime, sessionId)", () => {
      /*
       * rumApplicationId precedes startTime because the session list is
       * always application-scoped; sessionId is last so the replace key is
       * unique per session rather than collapsing distinct sessions.
       */
      expect(model.sortKeys).toEqual([
        "projectId",
        "rumApplicationId",
        "startTime",
        "sessionId",
      ]);
      expect(model.primaryKeys).toEqual(model.sortKeys);
    });

    it("partitions by session start date", () => {
      expect(model.partitionKey).toBe("toYYYYMMDD(startTime)");
    });

    it("declares the TTL and ttl_only_drop_parts", () => {
      expect(model.ttlExpression).toBe("retentionDate DELETE");
      expect(model.tableSettings).toContain("ttl_only_drop_parts = 1");
    });

    it("has no crudApiPath, because generic CRUD would expose un-collapsed duplicates", () => {
      /*
       * There is no FINAL support anywhere in this repo, so a generic CRUD
       * read would surface ReplacingMergeTree duplicates — worst for the
       * newest sessions, which sort first. Reads go through a bespoke
       * argMax endpoint instead.
       */
      expect(model.crudApiPath).toBeUndefined();
    });

    it("does NOT enable MCP", () => {
      /*
       * The MCP tool generator auto-generates tools from this flag. An LLM
       * agent must not be handed a tool that reads recordings of real end
       * users' screens.
       */
      expect(model.enableMCP).toBe(false);
    });

    it("does not grant session reads to the project-wide Viewer role", () => {
      /*
       * RumApplication's own read ACL includes Permission.Viewer. Reusing
       * it here would let every read-only project member browse recordings
       * of real end users.
       */
      expect(model.accessControl?.read).not.toContain(Permission.Viewer);
      expect(model.accessControl?.read).toContain(
        Permission.ReadRumSessionReplay,
      );
    });

    it("keeps the raw end-user label behind a narrower ACL than the rest of the row", () => {
      const label: AnalyticsTableColumn | undefined = findColumn(
        model,
        "identifiedUserLabel",
      );

      expect(label).toBeDefined();
      expect(label?.accessControl?.read).not.toContain(
        Permission.ReadRumSessionReplay,
      );
      expect(label?.accessControl?.read).toContain(
        Permission.ReadRumSessionReplayPayload,
      );
    });

    it("pairs the attributes map with an attributeKeys sibling", () => {
      /*
       * Without the sibling, appendMapKeyPresenceFilter emits no
       * key-presence pre-filter and every attribute query full-scans.
       */
      const attributes: AnalyticsTableColumn | undefined = findColumn(
        model,
        "attributes",
      );

      expect(attributes?.mapKeysColumn).toBe("attributeKeys");
      expect(columnKeys(model)).toContain("attributeKeys");
    });

    it("stores the metering signal and the un-biasing rate on the header", () => {
      /*
       * Metering reads sum(payloadBytes) off this narrow, date-partitioned
       * table rather than byteSize(*) over the blob table, which under
       * expiry-partitioning could not prune partitions and would time out
       * — and a timed-out staging run bills that day as zero forever.
       */
      expect(columnKeys(model)).toContain("payloadBytes");
      expect(columnKeys(model)).toContain("samplePercentageAtCapture");
    });

    it("carries both the clamped and the raw client start time", () => {
      /*
       * startTime is server-clamped because it feeds the partition key and
       * the TTL; the raw client value is kept so a skewed recording is
       * diagnosable rather than silently misleading.
       */
      expect(columnKeys(model)).toContain("startTime");
      expect(columnKeys(model)).toContain("clientReportedStartTime");
      expect(columnKeys(model)).toContain("clockSkewMs");
    });

    it("declares NO projections, because ClickHouse refuses them on this engine", () => {
      /*
       * "Projections are not supported for ReplacingMergeTree with
       * deduplicate_merge_projection_mode = throw" - raised by CREATE TABLE,
       * so it fails createTables() at boot and takes the whole App down.
       *
       * Nothing is really lost: the projection this table used to declare
       * ordered by (projectId, rumApplicationId, startTime), which is already
       * the prefix of the sort key.
       */
      expect(model.projections).toEqual([]);
    });

    it("generates a CREATE TABLE containing the load-bearing clauses", () => {
      const sql: string = createStatementFor(RumSession);

      expect(sql).toContain("version");
      expect(sql).toContain("toYYYYMMDD(startTime)");
      expect(sql).toContain("retentionDate");
      expect(sql).toContain("ttl_only_drop_parts = 1");
    });
  });

  describe("RumSessionChunk (payload table)", () => {
    const model: RumSessionChunk = new RumSessionChunk();

    it("is named RumSessionChunkV1", () => {
      expect(model.tableName).toBe(AnalyticsTableName.RumSessionChunk);
      expect(model.tableName).toBe("RumSessionChunkV1");
    });

    it("uses ReplacingMergeTree with a version column, so a redelivered chunk collapses", () => {
      /*
       * Idempotency comes from the engine plus read-time LIMIT 1 BY, NOT
       * from the tokened insert-dedup path — tokened submissions are
       * inserted individually, which would mean one INSERT statement per
       * chunk on the fattest table in the system.
       */
      expect(model.tableEngine).toBe(AnalyticsTableEngine.ReplacingMergeTree);
      expect(columnKeys(model)).toContain("version");
    });

    it("orders by (projectId, sessionId, tabId, chunkIndex) with no timestamp", () => {
      /*
       * The only read that exists is "this session, these indices". A
       * time-first key would scatter one session's dozen rows across a
       * whole day of marks.
       */
      expect(model.sortKeys).toEqual([
        "projectId",
        "sessionId",
        "tabId",
        "chunkIndex",
      ]);
      expect(model.primaryKeys).toEqual(model.sortKeys);
    });

    it("includes tabId in the sort key", () => {
      /*
       * sessionStorage is COPIED on tab duplication, so two live tabs can
       * share one sessionId and both mint chunkIndex from 0. Without tabId
       * the sort key cannot represent both and read-time dedup silently
       * discards one tab's entire recording. Not addable later.
       */
      expect(model.sortKeys).toContain("tabId");
    });

    it("partitions by EXPIRY date, not event time", () => {
      /*
       * ttl_only_drop_parts removes a part only when every row in it has
       * expired. Partitioned by session date, one day holding both a
       * 7-day and a 90-day application survives 90 days — a ~4x disk
       * multiplier on the largest table. Partitioned by expiry, each
       * partition is "everything that dies on day X" and drops whole.
       */
      expect(model.partitionKey).toBe("toYYYYMMDD(retentionDate)");
    });

    it("sets index_granularity to 128", () => {
      /*
       * At the default 8192 one granule of the payload column is ~10MB, so
       * extracting a single ~500KB session decompresses ~10MB — 20x read
       * amplification on the hottest read in the feature.
       */
      expect(model.tableSettings).toContain("index_granularity = 128");
    });

    it("puts NO skip index on the payload column", () => {
      /*
       * Chunks are fetched by key. An index over multi-hundred-KB values
       * would only inflate the part.
       */
      const payload: AnalyticsTableColumn | undefined = findColumn(
        model,
        "payload",
      );

      expect(payload).toBeDefined();
      expect(payload?.skipIndex).toBeUndefined();
    });

    it("gates the payload column on its own watch permission", () => {
      const payload: AnalyticsTableColumn | undefined = findColumn(
        model,
        "payload",
      );

      expect(payload?.accessControl?.read).toContain(
        Permission.ReadRumSessionReplayPayload,
      );
      expect(payload?.accessControl?.read).not.toContain(Permission.Viewer);
      /* Listing sessions must NOT be sufficient to read a payload. */
      expect(payload?.accessControl?.read).not.toContain(
        Permission.ReadRumSessionReplay,
      );
    });

    it("has no crudApiPath, so the payload is unreachable via generic CRUD", () => {
      expect(model.crudApiPath).toBeUndefined();
    });

    it("does NOT enable MCP", () => {
      expect(model.enableMCP).toBe(false);
    });

    it("derives retentionDate so a session expires atomically", () => {
      /*
       * Derived from the clamped session start rather than the ingest date.
       * Otherwise a chunk buffered offline and flushed hours later gets
       * full retention from arrival, so one session's chunks expire on
       * different days, TTL-drop mid-session, and leave an unplayable
       * fragment.
       */
      expect(columnKeys(model)).toContain("retentionDate");
      expect(model.ttlExpression).toBe("retentionDate DELETE");
    });

    it("carries per-chunk counters so the worker never decompresses the payload", () => {
      /*
       * These ride on the envelope and are summed by the finalizer. Reading
       * them from the payload would mean gunzipping every chunk on the
       * aggregation path, which defeats the whole storage design.
       */
      for (const counter of [
        "errorCount",
        "rageClickCount",
        "deadClickCount",
        "errorClickCount",
        "refreshRageCount",
        "routeCount",
      ]) {
        expect(columnKeys(model)).toContain(counter);
      }
    });

    it("reserves recorderKind and schemaVersion for the mobile recorder", () => {
      /*
       * Two small columns now are the difference between "a new package
       * plus one renderer" and "a column migration on the largest table in
       * the system" when mobile replay ships.
       */
      expect(columnKeys(model)).toContain("recorderKind");
      expect(columnKeys(model)).toContain("schemaVersion");
    });

    it("generates a CREATE TABLE containing the load-bearing clauses", () => {
      const sql: string = createStatementFor(RumSessionChunk);

      expect(sql).toContain("index_granularity = 128");
      expect(sql).toContain("toYYYYMMDD(retentionDate)");
      expect(sql).toContain("ttl_only_drop_parts = 1");
    });
  });

  describe("codec compatibility (repo-wide)", () => {
    /*
     * ClickHouse's T64 codec only applies to integers up to 64 bits. Pairing
     * it with a 128-bit column makes CREATE TABLE throw, which fails
     * createTables() during boot and takes the whole App down - not just
     * session replay.
     *
     * This escaped every other check: it type-checks, it lints, and every
     * unit test passes, because none of them execute the DDL. It surfaced as
     * an App that never returned HTTP 200 in the end-to-end job.
     *
     * Asserted across ALL registered models rather than just this feature's,
     * since the trap is not specific to session replay.
     */
    const WIDER_THAN_64_BITS: Array<TableColumnType> = [
      TableColumnType.LongNumber,
      TableColumnType.BigNumber,
      TableColumnType.ArrayBigNumber,
    ];

    it("never declares a projection on a ReplacingMergeTree", () => {
      /*
       * ClickHouse raises SUPPORT_IS_DISABLED at CREATE TABLE:
       * "Projections are not supported for ReplacingMergeTree with
       * deduplicate_merge_projection_mode = throw".
       *
       * Boot calls createTables() for every registered analytics service, so
       * one offending model does not degrade its own feature - it stops the
       * entire App from starting. That is exactly how this surfaced: a stack
       * that built cleanly and then 502'd forever.
       */
      const offenders: Array<string> = [];

      for (const modelType of AnalyticsModels) {
        const model: AnalyticsBaseModel = new modelType();

        if (
          model.tableEngine === AnalyticsTableEngine.ReplacingMergeTree &&
          model.projections.length > 0
        ) {
          offenders.push(model.tableName);
        }
      }

      expect(offenders).toEqual([]);
    });

    it("never pairs the T64 codec with a column wider than 64 bits", () => {
      const offenders: Array<string> = [];

      for (const modelType of AnalyticsModels) {
        const model: AnalyticsBaseModel = new modelType();

        for (const column of model.tableColumns) {
          if (!WIDER_THAN_64_BITS.includes(column.type)) {
            continue;
          }

          const codecs: Array<{ codec: string }> = Array.isArray(column.codec)
            ? (column.codec as Array<{ codec: string }>)
            : column.codec
              ? [column.codec as { codec: string }]
              : [];

          if (
            codecs.some((codec: { codec: string }): boolean => {
              return codec.codec === "T64";
            })
          ) {
            offenders.push(`${model.tableName}.${column.key} (${column.type})`);
          }
        }
      }

      expect(offenders).toEqual([]);
    });
  });

  describe("registration", () => {
    it("registers both models in the AnalyticsModels array", () => {
      /*
       * This array drives Realtime lookup and table-name resolution. The
       * SEPARATE AnalyticsServices array in Server/Services/Index.ts is
       * what boot-time createTables() iterates — both are required, and
       * missing the latter means the tables are silently never created.
       */
      const tableNames: Array<string> = AnalyticsModels.map(
        (modelType: { new (): AnalyticsBaseModel }): string => {
          return new modelType().tableName;
        },
      );

      expect(tableNames).toContain("RumSessionV1");
      expect(tableNames).toContain("RumSessionChunkV1");
    });
  });
});
