import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSnmpConfigsToNetworkDeviceDiscoveryScan1790000000001
  implements MigrationInterface
{
  public name: string =
    "AddSnmpConfigsToNetworkDeviceDiscoveryScan1790000000001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
     * The ordered list of SNMP credential sets a discovery scan tries against
     * every host, first match wins (OneUptime issue #3458).
     */
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ADD "snmpConfigs" jsonb`,
    );

    /*
     * Backfill every existing scan with the one credential set it already
     * had, taken from the flattened columns beside this one.
     *
     * The READER does not need this — SnmpScanConfigUtil.resolve() synthesizes
     * exactly this config whenever the column is NULL, which is why the
     * flattened columns are kept rather than dropped. The EDIT FORM does. Its
     * only SNMP control is the credential-list editor, so it selects
     * `snmpConfigs` alone; a scan whose column were NULL would open with a
     * blank card, and saving it would replace credentials the operator was
     * never shown. Backfilling here, and deriving the same list on every
     * create (NetworkDeviceDiscoveryScanService.onBeforeCreate), means the
     * column is populated for every scan the product has ever made.
     *
     * `id` is the same literal the resolver uses for a synthesized legacy
     * config, so a result stored against it before this migration still
     * resolves afterwards. It only has to be unique WITHIN the row's list,
     * which holds one entry.
     *
     * jsonb_strip_nulls drops the credentials this scan does not use, leaving
     * the same object shape the application writes: a v2c scan carries no v3
     * keys, a v3 scan no community string. snmpVersion is the one key
     * defaulted rather than dropped, because it is what decides how the rest
     * is read, and the column's own default is 'V2c'.
     */
    await queryRunner.query(
      `UPDATE "NetworkDeviceDiscoveryScan" SET "snmpConfigs" = jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(` +
        `'id', 'legacy', ` +
        `'snmpVersion', COALESCE("snmpVersion", 'V2c'), ` +
        `'snmpCommunityString', "snmpCommunityString", ` +
        `'snmpPort', "snmpPort", ` +
        `'snmpV3SecurityLevel', "snmpV3SecurityLevel", ` +
        `'snmpV3Username', "snmpV3Username", ` +
        `'snmpV3AuthProtocol', "snmpV3AuthProtocol", ` +
        `'snmpV3AuthKey', "snmpV3AuthKey", ` +
        `'snmpV3PrivProtocol', "snmpV3PrivProtocol", ` +
        `'snmpV3PrivKey', "snmpV3PrivKey"` +
        `))) WHERE "snmpConfigs" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    /*
     * The flattened columns were never stopped being written — the service
     * mirrors the list's first entry onto them on every save — so dropping
     * this column returns every scan to a working single-credential
     * configuration rather than to no credentials. A scan that was using more
     * than one credential set loses the extra ones, which is the unavoidable
     * cost of going back to a schema that cannot hold them.
     */
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" DROP COLUMN "snmpConfigs"`,
    );
  }
}
