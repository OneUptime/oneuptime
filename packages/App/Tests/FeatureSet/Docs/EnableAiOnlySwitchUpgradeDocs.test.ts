import {
  UPGRADING_PAGE,
  getHeadings,
  getSection,
  read,
} from "./KubernetesAiAgentDocsSupport";
import {
  FoldAiSwitchesIntoEnableAi1796800000000,
  TABLES_WITH_AI_REMEDIATION_MODE,
} from "Common/Server/Infrastructure/Postgres/SchemaMigrations/1796800000000-FoldAiSwitchesIntoEnableAi";
import { describe, expect, it } from "@jest/globals";

/*
 * The upgrade note for folding "Enable Auto-Remediation" and "Enable AI
 * Command Execution (for Runners)" into Enable AI, checked against the
 * migration that does it (FoldAiSwitchesIntoEnableAi1796800000000): what
 * the note promises the upgrade changes - and does not change - is what the
 * migration's statements do.
 */

const THIRTEEN_TO_FOURTEEN_HEADING: string =
  "## Upgrading from OneUptime 13 → 14";
const NOTE_HEADING: string = "### Enable AI is the only AI switch";

/*
 * The QueryRunner the migration's up() takes, read off the migration itself:
 * App and Common resolve typeorm to different copies, so importing it here
 * would name a type up() does not accept.
 */
type MigrationQueryRunner = Parameters<
  FoldAiSwitchesIntoEnableAi1796800000000["up"]
>[0];

type RecordStatementsFunction = () => Promise<Array<string>>;

const recordUpStatements: RecordStatementsFunction = async (): Promise<
  Array<string>
> => {
  const statements: Array<string> = [];

  const queryRunner: MigrationQueryRunner = {
    query: (statement: string): Promise<void> => {
      statements.push(statement);
      return Promise.resolve();
    },
  } as unknown as MigrationQueryRunner;

  await new FoldAiSwitchesIntoEnableAi1796800000000().up(queryRunner);

  return statements;
};

// The note as one line of text, so a claim may wrap anywhere.
function flatNote(): string {
  return getSection(read(UPGRADING_PAGE), NOTE_HEADING)
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

describe("the Enable AI upgrade note", () => {
  it("sits in the 13 → 14 notes, where the other 14 changes are", () => {
    const thirteenToFourteen: string = getSection(
      read(UPGRADING_PAGE),
      THIRTEEN_TO_FOURTEEN_HEADING,
    );

    expect(getHeadings(thirteenToFourteen)).toContain(NOTE_HEADING);
    expect(
      getHeadings(read(UPGRADING_PAGE)).filter((heading: string): boolean => {
        return heading === NOTE_HEADING;
      }),
    ).toHaveLength(1);
  });

  it("names the two switches that went, by the labels the page showed, and the one that stays", () => {
    const note: string = flatNote();

    expect(note).toContain("**Enable Auto-Remediation**");
    expect(note).toContain("**Enable AI Command Execution (for Runners)**");
    expect(note).toContain("**Project Settings → AI Features**");
    expect(note).toContain(
      "auto-remediation and AI commands on Runners run whenever **Enable AI** is on",
    );
  });

  it("says Enable AI off now stops rules that use no AI, including in projects where it is already off", () => {
    const note: string = flatNote();

    expect(note).toContain(
      "including auto-remediation rules that start a runbook without AI",
    );
    expect(note).toContain(
      "A project that already has **Enable AI** off therefore stops running those rules after the upgrade; turn **Enable AI** on to keep them.",
    );
  });

  describe("against the migration", () => {
    it("auto-remediation off: Full Auto rules and every unattended cluster and resource ask first", async () => {
      const note: string = flatNote();

      expect(note).toContain(
        "In a project that had turned **Enable Auto-Remediation** off, **Full Auto** rules become **Suggest**, and clusters and resources set to **Automatic** or **Bypass approval** become **Ask for approval**.",
      );

      const stepOne: Array<string> = (await recordUpStatements()).filter(
        (statement: string): boolean => {
          return statement.includes(`p."enableAutoRemediation" = false`);
        },
      );

      // Every rule (no aiComposesCommands filter) ...
      expect(
        stepOne.filter((statement: string): boolean => {
          return (
            statement.startsWith(`UPDATE "AutoRemediationRule"`) &&
            !statement.includes(`"aiComposesCommands"`)
          );
        }),
      ).toHaveLength(1);

      // ... and the cluster plus every resource table.
      for (const table of TABLES_WITH_AI_REMEDIATION_MODE) {
        expect(
          stepOne.filter((statement: string): boolean => {
            return statement.startsWith(`UPDATE "${table}" `);
          }),
        ).toHaveLength(1);
      }
      expect(TABLES_WITH_AI_REMEDIATION_MODE).toContain("KubernetesCluster");
      expect(TABLES_WITH_AI_REMEDIATION_MODE.length).toBeGreaterThan(1);
    });

    it("never opted in: only command rules and clusters reached through a bound Runner ask first", async () => {
      const note: string = flatNote();

      expect(note).toContain(
        "In a project that never turned on **Enable AI Command Execution**, **Full Auto** rules that let AI compose commands become **Suggest**.",
      );
      expect(note).toContain(
        "A Kubernetes cluster that AI reaches through a Runner you bound to it (with a Kubernetes credential) goes from **Automatic** or **Bypass approval** to **Ask for approval**.",
      );
      expect(note).toContain(
        "Clusters reached through the Kubernetes AI agent keep their mode, and so do resources: they never needed that switch.",
      );

      const stepTwo: Array<string> = (await recordUpStatements()).filter(
        (statement: string): boolean => {
          return statement.includes(`"enableAiCommandExecution" IS NOT TRUE`);
        },
      );

      expect(
        stepTwo.map((statement: string): string => {
          return statement.slice(0, statement.indexOf(" SET "));
        }),
      ).toEqual([
        `UPDATE "AutoRemediationRule" r`,
        `UPDATE "KubernetesCluster" c`,
      ]);
      expect(stepTwo[0]).toContain(`r."aiComposesCommands" = true`);
      // Joined to the bound Runner, excluding the chart's own.
      expect(stepTwo[1]).toContain(`runner."_id" = c."aiAccessRunnerId"`);
      expect(stepTwo[1]).toContain("AND NOT (");
    });

    it('"Nothing is turned off": no statement disables a rule or sets a mode to Off', async () => {
      expect(flatNote()).toContain("Nothing is turned off.");

      for (const statement of await recordUpStatements()) {
        if (!statement.startsWith("UPDATE ")) {
          continue;
        }

        const setClause: string = statement.slice(
          statement.indexOf(" SET ") + 5,
          statement.indexOf(" FROM "),
        );

        expect(setClause).not.toContain("isEnabled");
        expect(setClause).not.toContain("Disabled");
        expect([
          `"executionMode" = 'Suggest'`,
          `"aiRemediationMode" = 'RequireApproval'`,
        ]).toContain(setClause);
      }
    });

    it("the drops it warns API and Terraform users about are the migration's", async () => {
      const note: string = flatNote();

      expect(note).toContain(
        "`enableAutoRemediation` or `enableAiCommandExecution` (`enable_auto_remediation` or `enable_ai_command_execution` in Terraform)",
      );

      const statements: Array<string> = await recordUpStatements();

      expect(statements).toContain(
        `ALTER TABLE "Project" DROP COLUMN "enableAutoRemediation"`,
      );
      expect(statements).toContain(
        `ALTER TABLE "Project" DROP COLUMN "enableAiCommandExecution"`,
      );
    });
  });

  it("tells a project how to keep auto-remediation out without the removed switch", () => {
    const note: string = flatNote();

    expect(note).toContain(
      "To keep auto-remediation out of a project, turn off **Enable AI**, or disable its rules (Incidents or Alerts → AI → Remediation) and set **Fixes** to **Off** on each cluster's and resource's AI agent page.",
    );
  });
});
