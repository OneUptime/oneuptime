import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * AI connections (LlmObservabilityConnection): AI / LLM observability's
 * connections to AI provider accounts (usage and cost) and to company AI
 * tools (conversations), read on a schedule. One new table, so every index
 * is built and every foreign key checked on an empty table.
 *
 * LlmCostBudget.spendSource: what a budget counts, the project's AI calls
 * ('calls', the default, which every existing budget keeps) or what the
 * connected provider accounts report ('providers'). A column with a
 * constant default, added without rewriting the table.
 */
export class AddLlmObservabilityConnection1804400000000
  implements MigrationInterface
{
  public name: string = "AddLlmObservabilityConnection1804400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "LlmObservabilityConnection" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(50) NOT NULL, "provider" character varying(100) NOT NULL, "config" jsonb, "secrets" text NOT NULL, "isEnabled" boolean NOT NULL DEFAULT true, "storeConversationText" boolean NOT NULL DEFAULT true, "conversationReaders" character varying(100) NOT NULL DEFAULT 'admins', "serviceId" uuid, "nextPullAt" TIMESTAMP WITH TIME ZONE, "lastPulledAt" TIMESTAMP WITH TIME ZONE, "lastSuccessfulPullAt" TIMESTAMP WITH TIME ZONE, "lastPullResult" jsonb, "lastError" text, "pullState" jsonb, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_f054454187ac0c4d4a139c31fc6" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_702ffb81886646419888e8129b" ON "LlmObservabilityConnection" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_74a13a7c6a0cce1be910db2387" ON "LlmObservabilityConnection" ("provider") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f5c614f2ee6c4405919c12c8ba" ON "LlmObservabilityConnection" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a440a90dcad26438d6a3c720ec" ON "LlmObservabilityConnection" ("serviceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0262dcdecb80cf195ab4ce42f5" ON "LlmObservabilityConnection" ("nextPullAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmCostBudget" ADD "spendSource" character varying(100) NOT NULL DEFAULT 'calls'`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmObservabilityConnection" ADD CONSTRAINT "FK_702ffb81886646419888e8129ba" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmObservabilityConnection" ADD CONSTRAINT "FK_a440a90dcad26438d6a3c720ec2" FOREIGN KEY ("serviceId") REFERENCES "Service"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmObservabilityConnection" ADD CONSTRAINT "FK_968424aa474fb2de5b54f5e8979" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmObservabilityConnection" ADD CONSTRAINT "FK_581714c14d464060d75bc82bb88" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "LlmObservabilityConnection" DROP CONSTRAINT "FK_581714c14d464060d75bc82bb88"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmObservabilityConnection" DROP CONSTRAINT "FK_968424aa474fb2de5b54f5e8979"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmObservabilityConnection" DROP CONSTRAINT "FK_a440a90dcad26438d6a3c720ec2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmObservabilityConnection" DROP CONSTRAINT "FK_702ffb81886646419888e8129ba"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LlmCostBudget" DROP COLUMN "spendSource"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0262dcdecb80cf195ab4ce42f5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a440a90dcad26438d6a3c720ec"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f5c614f2ee6c4405919c12c8ba"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_74a13a7c6a0cce1be910db2387"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_702ffb81886646419888e8129b"`,
    );
    await queryRunner.query(`DROP TABLE "LlmObservabilityConnection"`);
  }
}
