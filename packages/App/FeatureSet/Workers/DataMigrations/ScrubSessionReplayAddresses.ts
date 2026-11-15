import DataMigrationBase from "./DataMigrationBase";
import ClickHouseMigrationUtil from "./ClickHouseMigrationUtil";
import { MaterializeInBackgroundOptions } from "./MaterializeAttributeValuesIndex";
import ScrubProductAnalyticsAddresses from "./ScrubProductAnalyticsAddresses";
import RumSession from "Common/Models/AnalyticsModels/RumSession";
import RumSessionChunk from "Common/Models/AnalyticsModels/RumSessionChunk";
import MetricService from "Common/Server/Services/MetricService";
import {
  getStorageTableName,
  onClusterClause,
} from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import {
  addressHasIdentifierSql,
  redactedAddressSql,
} from "Common/Server/Utils/AnalyticsDatabase/UrlScrubberSql";
import logger from "Common/Server/Utils/Logger";

/*
 * Session Replay's headers and chunks keep the addresses the scrubber kept
 * until #8385 and #8489: a JSON Web Token, an address escaped twice
 * ("someone%2540example.com"), a token in standard base64. The session list
 * shows a session's entry and exit page to everyone who may read the replay
 * list, so they are redacted where they are stored (#8490), as background
 * mutations on the local storage tables, ON CLUSTER:
 *
 *   1. RumSessionV1: a session's entryUrl, exitUrl and routes.
 *   2. RumSessionChunkV1: a chunk's url and routes, which the finalizer
 *      writes the header from. Only those columns are rewritten, never a
 *      chunk's recording.
 *
 * Each address is redacted, not scrubbed again: the segments of its path and
 * its hash route that are identifiers become "[redacted]"
 * (UrlScrubberSql.redactedAddressSql), and its scheme and host, the
 * allowlisted query the scrubber kept and the rest of it stay as written,
 * so an address that names no one is left exactly as it is. The rule never
 * takes for an identifier what the scrubber keeps.
 *
 * A recording itself still holds the address it was made on - its rrweb
 * Meta event and its network events are in its compressed payload, which
 * cannot be rewritten - until the application's replay retention removes
 * it, seven days by default and ninety at most.
 *
 * It also queues ScrubProductAnalyticsAddresses' statements again: that
 * migration may have run before the token rule took standard base64
 * (#8489), and its statements are built from the rule as it is now.
 *
 * Safe to run twice, at once too: what it rewrites or deletes no longer
 * matches. A table that does not exist has nothing to scrub, and is skipped.
 */
export default class ScrubSessionReplayAddresses extends DataMigrationBase {
  public constructor() {
    super("ScrubSessionReplayAddresses");
  }

  public static getSessionStorageTable(): string {
    return getStorageTableName(new RumSession().tableName);
  }

  public static getChunkStorageTable(): string {
    return getStorageTableName(new RumSessionChunk().tableName);
  }

  // An address column or lambda argument, redacted only when it names someone.
  public static redactedSql(address: string): string {
    return `if(${addressHasIdentifierSql(address)}, ${redactedAddressSql(address)}, ${address})`;
  }

  public static getScrubSessionsStatement(): string {
    return `ALTER TABLE ${ScrubSessionReplayAddresses.getSessionStorageTable()}${onClusterClause()} UPDATE entryUrl = ${ScrubSessionReplayAddresses.redactedSql("entryUrl")}, exitUrl = ${ScrubSessionReplayAddresses.redactedSql("exitUrl")}, routes = arrayMap(paUrl -> ${ScrubSessionReplayAddresses.redactedSql("paUrl")}, routes) WHERE ${addressHasIdentifierSql("entryUrl")} OR ${addressHasIdentifierSql("exitUrl")} OR arrayExists(paUrl -> ${addressHasIdentifierSql("paUrl")}, routes)`;
  }

  public static getScrubChunksStatement(): string {
    return `ALTER TABLE ${ScrubSessionReplayAddresses.getChunkStorageTable()}${onClusterClause()} UPDATE url = ${ScrubSessionReplayAddresses.redactedSql("url")}, routes = arrayMap(paUrl -> ${ScrubSessionReplayAddresses.redactedSql("paUrl")}, routes) WHERE ${addressHasIdentifierSql("url")} OR arrayExists(paUrl -> ${addressHasIdentifierSql("paUrl")}, routes)`;
  }

  // Each table, and what is queued on it, in the order they run.
  public static getSteps(): Array<{
    table: string;
    statements: Array<string>;
  }> {
    return [
      {
        table: ScrubSessionReplayAddresses.getSessionStorageTable(),
        statements: [ScrubSessionReplayAddresses.getScrubSessionsStatement()],
      },
      {
        table: ScrubSessionReplayAddresses.getChunkStorageTable(),
        statements: [ScrubSessionReplayAddresses.getScrubChunksStatement()],
      },
      ...ScrubProductAnalyticsAddresses.getSteps(),
    ];
  }

  public override async migrate(): Promise<void> {
    for (const step of ScrubSessionReplayAddresses.getSteps()) {
      /*
       * Boot and the migrate Job create the analytics tables before data
       * migrations run, so a table that does not exist has no rows.
       */
      if (!(await ClickHouseMigrationUtil.tableExists(step.table))) {
        logger.info(
          `ScrubSessionReplayAddresses: ${step.table} does not exist; nothing to scrub.`,
        );
        continue;
      }

      /*
       * Not caught: a mutation that could not be queued fails the migration,
       * so the runner tries it again on the next boot rather than record as
       * done a table that still holds what it was meant to scrub.
       */
      for (const statement of step.statements) {
        await MetricService.execute(statement, MaterializeInBackgroundOptions);
      }

      logger.info(
        `ScrubSessionReplayAddresses: queued the scrubbing of ${step.table}; it runs in the background (system.mutations).`,
      );
    }
  }

  public override async rollback(): Promise<void> {
    // Nothing to give back: what was redacted named a person or held a secret.
    return;
  }
}
