import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The two pull-request switches move from the project into its auto
 * remediation rules, and both kinds of rule name the code repositories
 * OneUptime AI may use.
 *
 * "Open a fix pull request when an investigation finds a code change" and
 * "Open a pull request that adds missing telemetry" were four project
 * columns, two for incidents and two for alerts, drawn under "Fix new
 * incidents automatically" (and alerts). The maintainer: "Both of these
 * toggles should be inside of Remediation Rule, inside of More, and they
 * should be checked by default ... If there are no rules, by the way, this
 * should happen by default." So each rule has the two switches
 * (AutoRemediationRule.openCodeFixPullRequests and
 * openTelemetryPullRequests, on by default), with no rule both are on, and
 * a pull request still opens only while fixing is on
 * (Types/AI/AutomaticFixPullRequests).
 *
 * Every project keeps its choice. The project's switches decided nothing
 * while fixing was off - the dashboard turned them on with fixing, and off
 * with it - so only a project with fixing on carries one over, per kind of
 * signal:
 *
 *   - its rules of that kind - enabled or not - take each switch it had
 *     off (CARRY_OVER_...);
 *   - with no enabled rule of that kind, there is no rule to hold a switch
 *     that was off, and with no rule both are on now. So the project gets
 *     one rule that keeps it off (ADD_RULE_KEEPING_...): it matches every
 *     incident (or alert), fixes without asking - which, naming no runbook,
 *     no Runner and no MCP server, is exactly what OneUptime AI did with
 *     no rule: fixes run on their own only where an AI agent's settings
 *     allow it, and everything else is proposed for approval - and holds
 *     the project's two switches as they were. Its name says what it
 *     matches, and its description why it is there.
 *
 * A project with fixing off, or with both switches on, gets no rule and
 * keeps its rules as they are: their switches start on, which is what
 * turning fixing on gave them before.
 *
 * Generated with npm run generate-postgres-migration, then put in this
 * order: the new tables and columns, the carry-over, and only then the
 * project's columns go. The join tables are new and empty, so their keys
 * and indexes are built here; the two rule columns have constant defaults,
 * so adding them rewrites no table.
 */

// The project's two switches of each kind of signal, as it held them.
interface SignalColumns {
  triggerEntityType: "Incident" | "Alert";
  fix: string;
  codeFix: string;
  telemetry: string;
  // What the rule that keeps a project's choice is called, and why it is there.
  ruleName: string;
  ruleDescription: string;
}

export const SIGNAL_COLUMNS: Array<SignalColumns> = [
  {
    triggerEntityType: "Incident",
    fix: "enableAutomaticIncidentRemediation",
    codeFix: "enableAutomaticIncidentCodeFixes",
    telemetry: "enableIncidentInstrumentationFixTasks",
    ruleName: "All incidents",
    ruleDescription:
      "Added when the pull request switches moved into auto remediation rules, to keep this project's choice. It fixes every incident the way OneUptime AI did with no rule; its pull request switches are under More fields.",
  },
  {
    triggerEntityType: "Alert",
    fix: "enableAutomaticAlertRemediation",
    codeFix: "enableAutomaticAlertCodeFixes",
    telemetry: "enableAlertInstrumentationFixTasks",
    ruleName: "All alerts",
    ruleDescription:
      "Added when the pull request switches moved into auto remediation rules, to keep this project's choice. It fixes every alert the way OneUptime AI did with no rule; its pull request switches are under More fields.",
  },
];

// A quote inside an SQL string literal is written twice.
const SINGLE_QUOTE: RegExp = /'/g;

// A project that has fixing on for the signal, and the switch off.
function isSwitchOffWhileFixing(
  signal: SignalColumns,
  switchColumn: string,
): string {
  return `project."${signal.fix}" = true AND project."${switchColumn}" = false`;
}

// Its rules of the signal's kind take the switch it had off.
export function getCarryOverStatement(data: {
  signal: SignalColumns;
  switchColumn: string;
  ruleColumn: "openCodeFixPullRequests" | "openTelemetryPullRequests";
}): string {
  return `UPDATE "AutoRemediationRule" AS rule SET "${data.ruleColumn}" = false FROM "Project" AS project WHERE rule."projectId" = project."_id" AND rule."triggerEntityType" = '${data.signal.triggerEntityType}' AND ${isSwitchOffWhileFixing(data.signal, data.switchColumn)}`;
}

export function getCarryOverStatements(): Array<string> {
  return SIGNAL_COLUMNS.flatMap((signal: SignalColumns): Array<string> => {
    return [
      getCarryOverStatement({
        signal,
        switchColumn: signal.codeFix,
        ruleColumn: "openCodeFixPullRequests",
      }),
      getCarryOverStatement({
        signal,
        switchColumn: signal.telemetry,
        ruleColumn: "openTelemetryPullRequests",
      }),
    ];
  });
}

/*
 * The rule that keeps a project's choice when it has no enabled rule of the
 * signal's kind (see above): every one of its matches fixed as with no
 * rule, the switches as the project held them. Its id and timestamps are
 * the table's own defaults.
 */
export function getAddRuleKeepingChoiceStatement(
  signal: SignalColumns,
): string {
  return `INSERT INTO "AutoRemediationRule" ("version", "projectId", "name", "description", "isEnabled", "triggerEntityType", "executionMode", "remediationAction", "aiSelectsRunbook", "aiComposesCommands", "autoResolveOnVerifiedRecovery", "openCodeFixPullRequests", "openTelemetryPullRequests") SELECT 1, project."_id", '${signal.ruleName}', '${signal.ruleDescription.replace(SINGLE_QUOTE, "''")}', true, '${signal.triggerEntityType}', 'FullAuto', 'OneUptimeAI', false, false, false, project."${signal.codeFix}", project."${signal.telemetry}" FROM "Project" AS project WHERE project."deletedAt" IS NULL AND project."${signal.fix}" = true AND (project."${signal.codeFix}" = false OR project."${signal.telemetry}" = false) AND NOT EXISTS (SELECT 1 FROM "AutoRemediationRule" AS rule WHERE rule."projectId" = project."_id" AND rule."triggerEntityType" = '${signal.triggerEntityType}' AND rule."isEnabled" = true AND rule."deletedAt" IS NULL)`;
}

export function getAddRuleKeepingChoiceStatements(): Array<string> {
  return SIGNAL_COLUMNS.map(getAddRuleKeepingChoiceStatement);
}

/*
 * down(): the project's switch is off when any of its rules of the kind has
 * it off, and on otherwise while fixing is on - the dashboard turned them
 * on with fixing. The rules a project got to keep its choice stay: with
 * nothing named they fix as no rule did.
 */
export function getRestoreProjectSwitchesStatement(
  signal: SignalColumns,
): string {
  return `UPDATE "Project" AS project SET "${signal.codeFix}" = (project."${signal.fix}" = true AND NOT EXISTS (SELECT 1 FROM "AutoRemediationRule" AS rule WHERE rule."projectId" = project."_id" AND rule."triggerEntityType" = '${signal.triggerEntityType}' AND rule."deletedAt" IS NULL AND rule."openCodeFixPullRequests" = false)), "${signal.telemetry}" = (project."${signal.fix}" = true AND NOT EXISTS (SELECT 1 FROM "AutoRemediationRule" AS rule WHERE rule."projectId" = project."_id" AND rule."triggerEntityType" = '${signal.triggerEntityType}' AND rule."deletedAt" IS NULL AND rule."openTelemetryPullRequests" = false))`;
}

export class MoveFixPullRequestSwitchesIntoRules1805830000000
  implements MigrationInterface
{
  public name: string = "MoveFixPullRequestSwitchesIntoRules1805830000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "AutoRemediationRuleCodeRepository" ("autoRemediationRuleId" uuid NOT NULL, "codeRepositoryId" uuid NOT NULL, CONSTRAINT "PK_032b1fcf95935df7d940e2d1049" PRIMARY KEY ("autoRemediationRuleId", "codeRepositoryId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ab08f3a9972761cca2da18a9a0" ON "AutoRemediationRuleCodeRepository" ("autoRemediationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f0bbfce27bbff4445fc3fced72" ON "AutoRemediationRuleCodeRepository" ("codeRepositoryId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "AIInvestigationRuleCodeRepository" ("aiInvestigationRuleId" uuid NOT NULL, "codeRepositoryId" uuid NOT NULL, CONSTRAINT "PK_cbf13d7f1da7e2b72ecddffc1cd" PRIMARY KEY ("aiInvestigationRuleId", "codeRepositoryId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_327e0b27b7bc63c38ab575518b" ON "AIInvestigationRuleCodeRepository" ("aiInvestigationRuleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_871a4ea7370ebfffa1015f5f2b" ON "AIInvestigationRuleCodeRepository" ("codeRepositoryId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD "openCodeFixPullRequests" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" ADD "openTelemetryPullRequests" boolean NOT NULL DEFAULT true`,
    );

    // Every project keeps its choice (see above), before its switches go.
    for (const statement of getCarryOverStatements()) {
      await queryRunner.query(statement);
    }

    for (const statement of getAddRuleKeepingChoiceStatements()) {
      await queryRunner.query(statement);
    }

    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableIncidentInstrumentationFixTasks"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableAlertInstrumentationFixTasks"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableAutomaticIncidentCodeFixes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableAutomaticAlertCodeFixes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleCodeRepository" ADD CONSTRAINT "FK_ab08f3a9972761cca2da18a9a0c" FOREIGN KEY ("autoRemediationRuleId") REFERENCES "AutoRemediationRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleCodeRepository" ADD CONSTRAINT "FK_f0bbfce27bbff4445fc3fced726" FOREIGN KEY ("codeRepositoryId") REFERENCES "CodeRepository"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRuleCodeRepository" ADD CONSTRAINT "FK_327e0b27b7bc63c38ab575518b3" FOREIGN KEY ("aiInvestigationRuleId") REFERENCES "AIInvestigationRule"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRuleCodeRepository" ADD CONSTRAINT "FK_871a4ea7370ebfffa1015f5f2b5" FOREIGN KEY ("codeRepositoryId") REFERENCES "CodeRepository"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRuleCodeRepository" DROP CONSTRAINT "FK_871a4ea7370ebfffa1015f5f2b5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIInvestigationRuleCodeRepository" DROP CONSTRAINT "FK_327e0b27b7bc63c38ab575518b3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleCodeRepository" DROP CONSTRAINT "FK_f0bbfce27bbff4445fc3fced726"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRuleCodeRepository" DROP CONSTRAINT "FK_ab08f3a9972761cca2da18a9a0c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableAutomaticAlertCodeFixes" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableAutomaticIncidentCodeFixes" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableAlertInstrumentationFixTasks" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableIncidentInstrumentationFixTasks" boolean NOT NULL DEFAULT false`,
    );

    for (const signal of SIGNAL_COLUMNS) {
      await queryRunner.query(getRestoreProjectSwitchesStatement(signal));
    }

    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "openTelemetryPullRequests"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "openCodeFixPullRequests"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_871a4ea7370ebfffa1015f5f2b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_327e0b27b7bc63c38ab575518b"`,
    );
    await queryRunner.query(`DROP TABLE "AIInvestigationRuleCodeRepository"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f0bbfce27bbff4445fc3fced72"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ab08f3a9972761cca2da18a9a0"`,
    );
    await queryRunner.query(`DROP TABLE "AutoRemediationRuleCodeRepository"`);
  }
}
