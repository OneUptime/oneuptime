import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration (issue #8091) after the
 * NetworkDevice model's Status index gained "isSnmpReachable" as its fourth
 * column.
 *
 * The Network Overview's "SNMP failing" list (reachable devices whose last
 * walk failed) and the device list's SNMP facet narrowed only by
 * ("projectId", "isArchived", "isReachable"), so both read the heap row of
 * every reachable device to find the few whose walk is failing: about one
 * pass over the table. ("projectId", "isArchived", "isReachable",
 * "isSnmpReachable") narrows them to the failing devices, and its
 * three-column prefix still serves the Status facet and the summary strip's
 * counts. The poll's verdict writes "isSnmpReachable" every time, but HOT is
 * blocked only by a changed value, and it changes only when a walk starts or
 * stops failing.
 *
 * Online, outside a transaction: probes claim and write devices all the
 * time. The generator dropped the old index first; the new one is built
 * before the old one goes, so the Status reads always have one. Safe to run
 * again after a stop part way.
 */
export class AddIsSnmpReachableToNetworkDeviceStatusIndex1809180100000
  implements MigrationInterface
{
  public name: string =
    "AddIsSnmpReachableToNetworkDeviceStatusIndex1809180100000";

  // CREATE / DROP INDEX CONCURRENTLY run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_cdebf2a6205db74d9b8e80316c" ON "NetworkDevice" ("projectId", "isArchived", "isReachable", "isSnmpReachable") `,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_2eb97a5af768174a679a32b011"`,
    );
  }

  /*
   * TypeORM reverts a migration inside a transaction whatever its
   * `transaction` says, where an index cannot be built online, so the build
   * is a plain one. The old index comes back before the new one goes.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_2eb97a5af768174a679a32b011" ON "NetworkDevice" ("projectId", "isArchived", "isReachable") `,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_cdebf2a6205db74d9b8e80316c"`,
    );
  }
}
