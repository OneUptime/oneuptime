import NotImplementedException from "Common/Types/Exception/NotImplementedException";

export default class DataMigrationBase {
  private _name: string = "";
  public get name(): string {
    return this._name;
  }
  public set name(v: string) {
    this._name = v;
  }

  public constructor(name: string) {
    this.name = name;
  }

  /*
   * Whether this migration should run when ClickHouse is deployed as a
   * sharded + replicated cluster (CLICKHOUSE_CLUSTER_NAME set). Default true.
   *
   * Legacy ClickHouse schema/DDL migrations override this to false: on a
   * clustered ClickHouse the boot schema-sync (AnalyticsTableManagement
   * .createTables / .createMaterializedViews) already builds the full current
   * cluster schema (local ReplicatedMergeTree + Distributed wrappers +
   * ON CLUSTER MVs), so these historical single-node migrations are
   * unnecessary — and would be harmful: they issue raw single-node DDL against
   * the now-Distributed / `*Local` tables, which fails and (because the runner
   * halts the chain on the first failure) would freeze every later migration.
   * The runner records such a migration as executed WITHOUT running it
   * ("baseline") in cluster mode only; in single-node mode this flag is ignored
   * and the migration runs exactly as before.
   *
   * Postgres-only migrations and cluster-aware migrations leave this true.
   */
  public runsInClusterMode(): boolean {
    return true;
  }

  public async migrate(): Promise<void> {
    throw new NotImplementedException();
  }

  public async rollback(): Promise<void> {
    throw new NotImplementedException();
  }
}
