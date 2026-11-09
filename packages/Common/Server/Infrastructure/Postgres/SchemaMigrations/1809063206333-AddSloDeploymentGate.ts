import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with TypeORM's migration:generate (the statements it generates
 * for the models), then renumbered after the last registered migration.
 *
 * The SLO deploy gate (issue #6333): a tier of an error budget policy can
 * freeze deployments (freezesDeployments), and the SLO answers CI/CD with
 * the worker-written deploymentsAllowed and the time deployments were frozen
 * (deploymentsFrozenAt). Every existing tier freezes nothing (false) and
 * every existing SLO allows deployments (true) until a tier says otherwise.
 * The columns are added with constant defaults and the nullable one with
 * none, so Postgres adds them without rewriting or scanning either table,
 * and there is no index or foreign key to build.
 */
export class AddSloDeploymentGate1809063206333 implements MigrationInterface {
  public name: string = "AddSloDeploymentGate1809063206333";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" ADD "deploymentsAllowed" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" ADD "deploymentsFrozenAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveErrorBudgetPolicyTier" ADD "freezesDeployments" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjectiveErrorBudgetPolicyTier" DROP COLUMN "freezesDeployments"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" DROP COLUMN "deploymentsFrozenAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" DROP COLUMN "deploymentsAllowed"`,
    );
  }
}
