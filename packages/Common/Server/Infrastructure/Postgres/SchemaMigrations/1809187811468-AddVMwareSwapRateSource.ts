import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Where a VMware part's swap rates came from (#11468): vSphere's own
 * counters, which a probe reads, or worked out from the swapped amount
 * between two reports, which is all the VMware agent can send. A nullable
 * column with no default: adding it rewrites no row, and ingest fills it on
 * each part's next report.
 */
export class AddVMwareSwapRateSource1809187811468
  implements MigrationInterface
{
  public name = "AddVMwareSwapRateSource1809187811468";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "VMwareResource" ADD "memorySwapRateSource" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "VMwareResource" DROP COLUMN "memorySwapRateSource"`,
    );
  }
}
