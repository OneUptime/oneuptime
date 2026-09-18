import { MigrationInterface, QueryRunner } from "typeorm";

export class IncreaseHostIpAddressesLength1785915638551
  implements MigrationInterface
{
  public name = "IncreaseHostIpAddressesLength1785915638551";

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
     * Change hostIpAddresses from varchar(500) to text.
     *
     * The OTel `host.ip` resource attribute is an array of every address on
     * every interface. A Docker host with IPv6 enabled reports the physical
     * NIC, one address per docker bridge, one per veth, plus an IPv6
     * link-local per interface — 55 addresses / ~1450 characters observed in
     * the wild, and the count grows with the container count. Overflowing
     * varchar(500) aborted the entire Host metadata UPDATE, so lastSeenAt
     * and otelCollectorStatus never advanced and a healthy host was shown as
     * "Disconnected". See issue #3006.
     */
    await queryRunner.query(
      `ALTER TABLE "Host" ALTER COLUMN "hostIpAddresses" TYPE text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    /*
     * Revert to varchar(500). Truncate first — rows written since `up` ran
     * may exceed 500 characters, and Postgres refuses the narrowing cast
     * with "value too long for type character varying(500)" rather than
     * truncating for us.
     */
    await queryRunner.query(
      `UPDATE "Host" SET "hostIpAddresses" = LEFT("hostIpAddresses", 500) WHERE LENGTH("hostIpAddresses") > 500`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ALTER COLUMN "hostIpAddresses" TYPE character varying(500)`,
    );
  }
}
