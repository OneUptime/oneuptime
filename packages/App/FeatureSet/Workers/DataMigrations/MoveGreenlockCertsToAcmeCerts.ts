import DataMigrationBase from "./DataMigrationBase";

/*
 * Ordered an ACME certificate for each status page domain the Greenlock
 * store knew, when ACME certificates replaced the store in April 2024.
 *
 * It has nothing left to do (#8990): the store's tables are gone
 * (DropGreenlockTables1809182470000), dropped by a schema migration, which
 * runs before any data migration. And it does not need to run: a domain the
 * store ordered a certificate for says it has one ordered, and the
 * certificate sweeps order it again when it has none
 * (StatusPageDomainService.checkOrderStatus); one never ordered is ordered
 * by the order sweep once its record is verified. They do it a few domains
 * at a time, within Let's Encrypt's limits, where this ordered every domain
 * at once.
 *
 * It stays registered, under its name, so the order of the data migrations
 * - and every installation's record of the ones that ran - stays as it was.
 */
export default class MoveGreenlockCertsToAcmeCerts extends DataMigrationBase {
  public constructor() {
    super("MoveGreenlockCertsToAcmeCerts");
  }

  public override async migrate(): Promise<void> {
    return;
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
