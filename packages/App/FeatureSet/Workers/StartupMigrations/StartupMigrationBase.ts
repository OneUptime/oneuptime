import NotImplementedException from "Common/Types/Exception/NotImplementedException";

/*
 * Base class for startup migrations. Unlike data migrations (DataMigrations/),
 * startup migrations are NOT tracked in the DataMigration table and run on
 * EVERY boot — use them for idempotent, declarative syncs of env-driven state
 * (e.g. the env-seeded global LLM provider), never for one-off schema or data
 * changes.
 */
export default class StartupMigrationBase {
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

  public async migrate(): Promise<void> {
    throw new NotImplementedException();
  }
}
