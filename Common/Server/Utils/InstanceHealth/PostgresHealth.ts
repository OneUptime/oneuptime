import PostgresAppInstance, {
  DatabaseSource,
} from "../../Infrastructure/PostgresDatabase";
import logger from "../Logger";

/*
 * Postgres refuses all writes once transaction-ID age reaches 2^31. Utilization
 * is expressed against that hard ceiling rather than autovacuum_freeze_max_age,
 * which is only the point where autovacuum is forced to intervene and is
 * routinely exceeded on a healthy instance.
 */
export const POSTGRES_WRAPAROUND_CEILING: number = 2147483648;

const BYTES_PER_GB: number = 1024 * 1024 * 1024;

export interface PostgresReplicationSlotSnapshot {
  slotName: string;
  slotType: string;
  isActive: boolean;
  walStatus: string;
  // null on a standby, where the current WAL LSN is not comparable.
  retainedWalInBytes: number | null;
}

export interface PostgresHealthSnapshot {
  databaseSizeInBytes: number | null;
  /*
   * pg_wal is on the same volume as the data but outside pg_database_size, and
   * it is exactly where an abandoned replication slot puts its bytes. null when
   * pg_ls_waldir() is not permitted, which it is not for an unprivileged role.
   */
  walSizeInBytes: number | null;
  maxConnections: number | null;
  // max_connections minus the slots ordinary clients may not use.
  usableConnections: number | null;
  clientBackends: number | null;
  connectionUtilizationPercent: number | null;
  transactionIdAge: number | null;
  multiXactIdAge: number | null;
  // The worse of the two ages above, since either one halts writes.
  maxTransactionIdAge: number | null;
  wraparoundUtilizationPercent: number | null;
  /*
   * null when the slot probe could not run; an empty array when it ran and this
   * instance genuinely has no replication slots. The caller must not conflate
   * the two — "no slots" is healthy, "could not ask" is unknown.
   */
  replicationSlots: Array<PostgresReplicationSlotSnapshot> | null;
  isInRecovery: boolean;
}

export function gigabytesToBytes(gigabytes: number): number {
  return gigabytes * BYTES_PER_GB;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed: number = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/*
 * Every probe is guarded on its own so a permission error or a feature missing
 * on this Postgres version (pg_replication_slots columns differ across major
 * versions) leaves that one field null instead of blanking the whole snapshot.
 * A null field means "not evaluated"; callers must not read it as healthy.
 */
export async function getPostgresHealthSnapshot(): Promise<PostgresHealthSnapshot | null> {
  const dataSource: DatabaseSource | null = PostgresAppInstance.getDataSource();

  if (!dataSource) {
    return null;
  }

  const snapshot: PostgresHealthSnapshot = {
    databaseSizeInBytes: null,
    walSizeInBytes: null,
    maxConnections: null,
    usableConnections: null,
    clientBackends: null,
    connectionUtilizationPercent: null,
    transactionIdAge: null,
    multiXactIdAge: null,
    maxTransactionIdAge: null,
    wraparoundUtilizationPercent: null,
    replicationSlots: null,
    isInRecovery: false,
  };

  try {
    const rows: Array<{ in_recovery: boolean }> = await dataSource.query(
      "SELECT pg_is_in_recovery() AS in_recovery",
    );
    snapshot.isInRecovery = Boolean(rows?.[0]?.in_recovery);
  } catch (error) {
    logger.debug("InstanceHealth: postgres recovery-state probe failed");
    logger.debug(error);
  }

  try {
    const rows: Array<{ size: string }> = await dataSource.query(
      "SELECT pg_database_size(current_database()) AS size",
    );
    snapshot.databaseSizeInBytes = toNumberOrNull(rows?.[0]?.size);
  } catch (error) {
    logger.debug("InstanceHealth: pg_database_size probe failed");
    logger.debug(error);
  }

  /*
   * WAL is measured separately because it lives on the same volume but outside
   * pg_database_size, and an abandoned replication slot parks tens of gigabytes
   * there. Without it the storage check can read comfortably under threshold
   * while the volume is full and writes are already failing. pg_ls_waldir()
   * needs superuser or pg_monitor, so this stays best-effort.
   */
  try {
    const rows: Array<{ size: string }> = await dataSource.query(
      "SELECT COALESCE(sum(size), 0) AS size FROM pg_ls_waldir()",
    );
    snapshot.walSizeInBytes = toNumberOrNull(rows?.[0]?.size);
  } catch (error) {
    logger.debug("InstanceHealth: pg_ls_waldir probe failed");
    logger.debug(error);
  }

  /*
   * Backends come from pg_stat_database.numbackends rather than counting
   * pg_stat_activity rows. pg_stat_activity nulls backend_type (and state, and
   * client_addr) for backends belonging to other roles unless the caller is a
   * superuser or holds pg_read_all_stats/pg_monitor, so a filtered count sees
   * only OneUptime's own connections on a managed or hardened cluster. That
   * failure is silent — no error, no null — so it would read as healthy while
   * another tenant exhausts the cluster, and would actively resolve an alert
   * raised earlier from a privileged role. numbackends is not masked.
   *
   * The denominator subtracts the slots reserved for superusers (and, from PG
   * 16, for pg_use_reserved_connections): ordinary clients are refused once
   * those are all that remain, so measuring against raw max_connections
   * understates saturation and can put the critical tier out of reach entirely
   * on a small max_connections.
   */
  try {
    const rows: Array<{
      max_connections: string | null;
      reserved_connections: string | null;
      backends: string | null;
    }> = await dataSource.query(
      `SELECT
         (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_connections,
         COALESCE((SELECT setting::int FROM pg_settings WHERE name = 'superuser_reserved_connections'), 0)
           + COALESCE((SELECT setting::int FROM pg_settings WHERE name = 'reserved_connections'), 0)
           AS reserved_connections,
         (SELECT COALESCE(sum(numbackends), 0) FROM pg_stat_database) AS backends`,
    );

    const maxConnections: number | null = toNumberOrNull(
      rows?.[0]?.max_connections,
    );
    const reservedConnections: number =
      toNumberOrNull(rows?.[0]?.reserved_connections) ?? 0;
    const clientBackends: number | null = toNumberOrNull(rows?.[0]?.backends);
    const usableConnections: number | null =
      maxConnections === null
        ? null
        : Math.max(1, maxConnections - reservedConnections);

    snapshot.maxConnections = maxConnections;
    snapshot.usableConnections = usableConnections;
    snapshot.clientBackends = clientBackends;
    snapshot.connectionUtilizationPercent =
      usableConnections !== null && clientBackends !== null
        ? (clientBackends / usableConnections) * 100
        : null;
  } catch (error) {
    logger.debug("InstanceHealth: postgres connection probe failed");
    logger.debug(error);
  }

  /*
   * Multixact age is an independent counter with the same 2^31 ceiling and the
   * same consequence — Postgres stops accepting commands to avoid wraparound
   * data loss. An FK-heavy or SELECT ... FOR SHARE workload can exhaust it while
   * ordinary XID age looks fine, so the check reports whichever is worse.
   */
  try {
    const rows: Array<{
      max_xid_age: string | null;
      max_mxid_age: string | null;
    }> = await dataSource.query(
      `SELECT
         max(age(datfrozenxid)) AS max_xid_age,
         max(mxid_age(datminmxid)) AS max_mxid_age
       FROM pg_database`,
    );

    const transactionIdAge: number | null = toNumberOrNull(
      rows?.[0]?.max_xid_age,
    );
    const multiXactIdAge: number | null = toNumberOrNull(
      rows?.[0]?.max_mxid_age,
    );
    const maxTransactionIdAge: number | null =
      transactionIdAge === null && multiXactIdAge === null
        ? null
        : Math.max(transactionIdAge ?? 0, multiXactIdAge ?? 0);

    snapshot.transactionIdAge = transactionIdAge;
    snapshot.multiXactIdAge = multiXactIdAge;
    snapshot.maxTransactionIdAge = maxTransactionIdAge;
    snapshot.wraparoundUtilizationPercent =
      maxTransactionIdAge !== null
        ? (maxTransactionIdAge / POSTGRES_WRAPAROUND_CEILING) * 100
        : null;
  } catch (error) {
    logger.debug("InstanceHealth: postgres wraparound probe failed");
    logger.debug(error);
  }

  /*
   * wal_status arrived in Postgres 13. On an older external database the column
   * simply does not exist and the whole statement errors, which would silence
   * the slot check entirely — even though restart_lsn and pg_wal_lsn_diff are
   * available there and the retained-WAL half of the check works fine. So the
   * version-specific column is dropped on a retry rather than taking the rest
   * of the probe down with it.
   */
  const buildSlotQuery: (withWalStatus: boolean) => string = (
    withWalStatus: boolean,
  ): string => {
    return `SELECT
         slot_name,
         slot_type,
         active,
         ${withWalStatus ? "COALESCE(wal_status, 'unknown')" : "'unknown'"} AS wal_status,
         CASE WHEN pg_is_in_recovery() THEN NULL
              ELSE pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) END AS retained_bytes
       FROM pg_replication_slots
       ORDER BY slot_name ASC`;
  };

  type SlotRow = {
    slot_name: string | null;
    slot_type: string | null;
    active: boolean;
    wal_status: string | null;
    retained_bytes: string | null;
  };

  let slotRows: Array<SlotRow> | null = null;

  try {
    slotRows = await dataSource.query(buildSlotQuery(true));
  } catch (error) {
    logger.debug(
      "InstanceHealth: pg_replication_slots probe failed, retrying without wal_status",
    );
    logger.debug(error);

    try {
      slotRows = await dataSource.query(buildSlotQuery(false));
    } catch (retryError) {
      logger.debug("InstanceHealth: pg_replication_slots probe failed");
      logger.debug(retryError);
    }
  }

  if (slotRows) {
    snapshot.replicationSlots = slotRows.map(
      (row: SlotRow): PostgresReplicationSlotSnapshot => {
        return {
          slotName: String(row.slot_name || ""),
          slotType: String(row.slot_type || "unknown"),
          isActive: Boolean(row.active),
          walStatus: String(row.wal_status || "unknown"),
          retainedWalInBytes: toNumberOrNull(row.retained_bytes),
        };
      },
    );
  }

  return snapshot;
}
