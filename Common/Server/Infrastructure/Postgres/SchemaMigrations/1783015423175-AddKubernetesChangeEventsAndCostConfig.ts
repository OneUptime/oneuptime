import { MigrationInterface, QueryRunner } from "typeorm";

export class AddKubernetesChangeEventsAndCostConfig1783015423175
  implements MigrationInterface
{
  public name = "AddKubernetesChangeEventsAndCostConfig1783015423175";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "KubernetesResourceChangeEvent" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "kubernetesClusterId" uuid NOT NULL, "kind" character varying(100) NOT NULL, "namespaceKey" character varying(100) NOT NULL DEFAULT '', "name" character varying(100) NOT NULL, "changeType" character varying(100) NOT NULL, "oldSpec" jsonb, "newSpec" jsonb, "specHash" character varying(100), "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_170a734fd7d4b78ef6ec7896448" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c0532f23933bdc556b6f0fbaae" ON "KubernetesResourceChangeEvent" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e1ff160ecd6f7a72f8c75e8281" ON "KubernetesResourceChangeEvent" ("kubernetesClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_74b1e32469b6bf6ff293a53d46" ON "KubernetesResourceChangeEvent" ("projectId", "kubernetesClusterId", "kind", "namespaceKey", "name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0bacd0c0509eae07fc563fae05" ON "KubernetesResourceChangeEvent" ("projectId", "kubernetesClusterId", "occurredAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" ADD "costPerCpuCoreHour" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" ADD "costPerGbMemoryHour" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" ADD "currencyCode" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" ADD "specHash" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResourceChangeEvent" ADD CONSTRAINT "FK_c0532f23933bdc556b6f0fbaae9" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResourceChangeEvent" ADD CONSTRAINT "FK_e1ff160ecd6f7a72f8c75e8281b" FOREIGN KEY ("kubernetesClusterId") REFERENCES "KubernetesCluster"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResourceChangeEvent" ADD CONSTRAINT "FK_9e5d0638e3db2761c9fea4917a9" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResourceChangeEvent" ADD CONSTRAINT "FK_e739b0246bed11a0933f837ffa1" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "KubernetesResourceChangeEvent" DROP CONSTRAINT "FK_e739b0246bed11a0933f837ffa1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResourceChangeEvent" DROP CONSTRAINT "FK_9e5d0638e3db2761c9fea4917a9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResourceChangeEvent" DROP CONSTRAINT "FK_e1ff160ecd6f7a72f8c75e8281b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResourceChangeEvent" DROP CONSTRAINT "FK_c0532f23933bdc556b6f0fbaae9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" DROP COLUMN "specHash"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" DROP COLUMN "currencyCode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" DROP COLUMN "costPerGbMemoryHour"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" DROP COLUMN "costPerCpuCoreHour"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0bacd0c0509eae07fc563fae05"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_74b1e32469b6bf6ff293a53d46"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e1ff160ecd6f7a72f8c75e8281"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c0532f23933bdc556b6f0fbaae"`,
    );
    await queryRunner.query(`DROP TABLE "KubernetesResourceChangeEvent"`);
  }
}
