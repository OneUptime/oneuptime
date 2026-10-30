import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import AIRunService from "../../../Server/Services/AIRunService";
import AutoRemediationDecisionService from "../../../Server/Services/AutoRemediationDecisionService";
import AutoRemediationRuleEngineService from "../../../Server/Services/AutoRemediationRuleEngineService";
import AutoRemediationSuggestionService from "../../../Server/Services/AutoRemediationSuggestionService";
import FixFromIncidentTaskTrigger from "../../../Server/Utils/AI/SRE/FixFromIncidentTaskTrigger";
import logger from "../../../Server/Utils/Logger";
import AIRunCodeFixRecommendation from "../../../Types/AI/AIRunCodeFixRecommendation";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import AIRunType from "../../../Types/AI/AIRunType";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import {
  AutoRemediationDecisionEntry,
  AutoRemediationDecisionHelper,
  AutoRemediationDecisionLane,
  AutoRemediationDecisionReason,
  AutoRemediationDecisionStage,
} from "../../../Types/AutoRemediation/AutoRemediationDecision";
import { RemediationTryAgainResult } from "../../../Types/AutoRemediation/RemediationTryAgain";
import ObjectID from "../../../Types/ObjectID";
import {
  AutomaticCodeFixBlocker,
  InvestigationCodeFixSuggestion,
} from "../../../Utils/Suggestions/InvestigationCodeFixSuggestion";
import SuggestionOffer from "../../../Utils/Suggestions/SuggestionOffer";
import { DataSource } from "typeorm";

/*
 * BLOCK 43 ON A REAL POSTGRES: "I have auto remediation enabled ... but I do
 * not see any remediation happening at all."
 *
 * Opt in with RUN_POSTGRES_AI_REMEDIATION_TESTS=true against a database the
 * registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_AI_REMEDIATION_TESTS=true \
 *   AI_REMEDIATION_TEST_DATABASE_HOST=127.0.0.1 \
 *   AI_REMEDIATION_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/AiRemediationTryAgainPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml ("Test why AI
 * remediation did not run, and Try again, on migrated Postgres").
 *
 * The production rule engine and code-fix trigger run against structure-only
 * clones of the tables they read and write (Project, Incident, Alert, their
 * states, AI rules, decisions, suggestions, AI runs and repositories) in a
 * schema of their own; every other table they read is the migrated, empty
 * public one. Only the per-record lock is stubbed (no Valkey here), and the
 * dashboard's realtime and workflow triggers. Pinned:
 *
 *   - each reason fixing stopped is written down where the Remediation step
 *     reads it: Enable AI off, the record kind's fixing switch off (alerts
 *     off while incidents are on), linked to nothing, AI rules set up that
 *     do not match, matching rules that only investigate;
 *   - the cause: a decision is made once, with the settings of that moment.
 *     An incident declared while fixing was off still said so after fixing
 *     was turned on - and Try again now decides it again, as for a new
 *     incident, and writes the new decision the step shows (the old one is
 *     kept);
 *   - what Try again refuses, read from real rows: decided moments ago (the
 *     row's own createdAt), resolved (the project's resolved state), still
 *     waiting for its investigation, a fix waiting for approval;
 *   - the fix in the code a recommended investigation leads to: why it did
 *     not open on its own (no repository, fixing off), and the pull request
 *     OneUptime AI is writing.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_AI_REMEDIATION_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "Project",
  "IncidentState",
  "AlertState",
  "Incident",
  "Alert",
  "AutoRemediationRule",
  "AutoRemediationDecision",
  "AutoRemediationSuggestion",
  "AIRun",
  "CodeRepository",
];

describePostgres("why AI remediation did not run, on migrated Postgres", () => {
  const schema: string = `ai_remediation_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;

  let database: DataSource;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["AI_REMEDIATION_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["AI_REMEDIATION_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["AI_REMEDIATION_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      /*
       * No schema option: TypeORM would then name every table with it, the
       * join tables and the ones the engine only reads included. The search
       * path alone finds the clones first, and the migrated public tables
       * for the rest.
       */
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    const currentSchema: Array<{ current_schema: string }> =
      await database.query("SELECT current_schema()");
    expect(currentSchema[0]?.current_schema).toBe(schema);

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    // No Valkey in this job: the per-record lock is granted at once.
    jest
      .spyOn(Semaphore, "lock")
      .mockResolvedValue({ identifier: "lock" } as never);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);

    for (const service of [
      AutoRemediationDecisionService,
      AutoRemediationSuggestionService,
      AIRunService,
    ]) {
      jest
        .spyOn(service, "onTriggerRealtime" as never)
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(service, "onTriggerWorkflow" as never)
        .mockResolvedValue(undefined as never);
    }

    jest.spyOn(logger, "debug").mockImplementation((): void => {});
    jest.spyOn(logger, "warn").mockImplementation((): void => {});
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    await database.query(
      TABLES.map((table: string): string => {
        return `DELETE FROM "${schema}"."${table}"`;
      }).join("; "),
    );
  });

  interface SeededProject {
    projectId: ObjectID;
    openIncidentStateId: ObjectID;
    resolvedIncidentStateId: ObjectID;
    openAlertStateId: ObjectID;
  }

  async function seedProject(switches: {
    enableAi?: boolean;
    incidents?: boolean;
    alerts?: boolean;
  }): Promise<SeededProject> {
    const projectId: ObjectID = ObjectID.generate();

    await database.query(
      `INSERT INTO "${schema}"."Project"
        ("_id", "name", "slug", "version", "enableAi", "enableAutomaticIncidentRemediation", "enableAutomaticAlertRemediation")
       VALUES ($1, 'Acme', $2, 1, $3, $4, $5)`,
      [
        projectId.toString(),
        `acme-${projectId.toString()}`,
        switches.enableAi ?? true,
        switches.incidents ?? false,
        switches.alerts ?? false,
      ],
    );

    const state: (
      table: "IncidentState" | "AlertState",
      name: string,
      order: number,
      flags: { isCreatedState?: boolean; isResolvedState?: boolean },
    ) => Promise<ObjectID> = async (
      table: "IncidentState" | "AlertState",
      name: string,
      order: number,
      flags: { isCreatedState?: boolean; isResolvedState?: boolean },
    ): Promise<ObjectID> => {
      const id: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."${table}"
          ("_id", "projectId", "name", ${table === "IncidentState" ? '"slug", ' : ""}"color", "order", "isCreatedState", "isResolvedState", "version")
         VALUES ($1, $2, $3, ${table === "IncidentState" ? "$7, " : ""}'#ff0000', $4, $5, $6, 1)`,
        [
          id.toString(),
          projectId.toString(),
          name,
          order,
          flags.isCreatedState ?? false,
          flags.isResolvedState ?? false,
          ...(table === "IncidentState"
            ? [`${name.toLowerCase()}-${id.toString()}`]
            : []),
        ],
      );
      return id;
    };

    const openIncidentStateId: ObjectID = await state(
      "IncidentState",
      "Identified",
      1,
      { isCreatedState: true },
    );
    const resolvedIncidentStateId: ObjectID = await state(
      "IncidentState",
      "Resolved",
      3,
      { isResolvedState: true },
    );
    const openAlertStateId: ObjectID = await state(
      "AlertState",
      "Identified",
      1,
      {
        isCreatedState: true,
      },
    );
    await state("AlertState", "Resolved", 3, { isResolvedState: true });

    return {
      projectId,
      openIncidentStateId,
      resolvedIncidentStateId,
      openAlertStateId,
    };
  }

  async function seedIncident(
    project: SeededProject,
    options: { isResolved?: boolean; title?: string } = {},
  ): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    await database.query(
      `INSERT INTO "${schema}"."Incident"
        ("_id", "projectId", "title", "slug", "currentIncidentStateId", "incidentSeverityId", "version")
       VALUES ($1, $2, $3, $4, $5, $6, 1)`,
      [
        id.toString(),
        project.projectId.toString(),
        options.title || "Checkout API returns 500 after deploy",
        `incident-${id.toString()}`,
        (options.isResolved
          ? project.resolvedIncidentStateId
          : project.openIncidentStateId
        ).toString(),
        ObjectID.generate().toString(),
      ],
    );
    return id;
  }

  async function seedAlert(project: SeededProject): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    await database.query(
      `INSERT INTO "${schema}"."Alert"
        ("_id", "projectId", "title", "currentAlertStateId", "alertSeverityId", "version")
       VALUES ($1, $2, 'Pod memory above 90% on oneuptime-test', $3, $4, 1)`,
      [
        id.toString(),
        project.projectId.toString(),
        project.openAlertStateId.toString(),
        ObjectID.generate().toString(),
      ],
    );
    return id;
  }

  async function setSwitch(
    project: SeededProject,
    column:
      | "enableAi"
      | "enableAutomaticIncidentRemediation"
      | "enableAutomaticAlertRemediation",
    value: boolean,
  ): Promise<void> {
    await database.query(
      `UPDATE "${schema}"."Project" SET "${column}" = $2 WHERE "_id" = $1`,
      [project.projectId.toString(), value],
    );
  }

  // The decisions written for a record, oldest first.
  async function decisionsOf(subject: {
    incidentId?: ObjectID;
    alertId?: ObjectID;
  }): Promise<
    Array<{ stage: string; entries: Array<AutoRemediationDecisionEntry> }>
  > {
    const rows: Array<{ stage: string; entries: unknown }> =
      await database.query(
        `SELECT "stage", "entries" FROM "${schema}"."AutoRemediationDecision"
          WHERE ${subject.incidentId ? '"incidentId"' : '"alertId"'} = $1
          ORDER BY "createdAt" ASC`,
        [(subject.incidentId || subject.alertId)!.toString()],
      );

    return rows.map((row: { stage: string; entries: unknown }) => {
      return {
        stage: row.stage,
        entries: AutoRemediationDecisionHelper.parseEntries(row.entries),
      };
    });
  }

  function reasonsOf(
    entries: Array<AutoRemediationDecisionEntry>,
  ): Array<string> {
    return entries.map((entry: AutoRemediationDecisionEntry): string => {
      return `${entry.lane}:${entry.reason}`;
    });
  }

  async function backdateDecisions(minutes: number): Promise<void> {
    await database.query(
      `UPDATE "${schema}"."AutoRemediationDecision"
          SET "createdAt" = "createdAt" - make_interval(mins => $1)`,
      [minutes],
    );
  }

  const LINKED_TO_NOTHING: Array<string> = [
    `${AutoRemediationDecisionLane.KubernetesCluster}:${AutoRemediationDecisionReason.ClusterNoneLinked}`,
    `${AutoRemediationDecisionLane.Resource}:${AutoRemediationDecisionReason.ResourceNoneLinked}`,
  ];

  describe("each reason fixing stopped is written where the Remediation step reads it", () => {
    test("Enable AI off", async () => {
      const project: SeededProject = await seedProject({
        enableAi: false,
        incidents: true,
      });
      const incidentId: ObjectID = await seedIncident(project);

      await AutoRemediationRuleEngineService.applyRulesToIncidentById({
        incidentId,
        projectId: project.projectId,
      });

      const decisions: Awaited<ReturnType<typeof decisionsOf>> =
        await decisionsOf({ incidentId });
      expect(decisions).toHaveLength(1);
      expect(decisions[0]!.stage).toBe(AutoRemediationDecisionStage.Evaluated);
      expect(reasonsOf(decisions[0]!.entries)).toEqual([
        `${AutoRemediationDecisionLane.Project}:${AutoRemediationDecisionReason.EnableAiOff}`,
      ]);
    });

    test("Fix new incidents automatically off", async () => {
      const project: SeededProject = await seedProject({ incidents: false });
      const incidentId: ObjectID = await seedIncident(project);

      await AutoRemediationRuleEngineService.applyRulesToIncidentById({
        incidentId,
        projectId: project.projectId,
      });

      expect(
        reasonsOf((await decisionsOf({ incidentId }))[0]!.entries),
      ).toEqual([
        `${AutoRemediationDecisionLane.Project}:${AutoRemediationDecisionReason.RemediationOff}`,
      ]);
    });

    test("an alert, while only incidents are fixed automatically: the maintainer's alert", async () => {
      const project: SeededProject = await seedProject({
        incidents: true,
        alerts: false,
      });
      const alertId: ObjectID = await seedAlert(project);

      await AutoRemediationRuleEngineService.applyRulesToAlertById({
        alertId,
        projectId: project.projectId,
      });

      expect(reasonsOf((await decisionsOf({ alertId }))[0]!.entries)).toEqual([
        `${AutoRemediationDecisionLane.Project}:${AutoRemediationDecisionReason.RemediationOff}`,
      ]);
    });

    test("fixing on, and the incident linked to nothing a fix acts on", async () => {
      const project: SeededProject = await seedProject({ incidents: true });
      const incidentId: ObjectID = await seedIncident(project);

      await AutoRemediationRuleEngineService.applyRulesToIncidentById({
        incidentId,
        projectId: project.projectId,
      });

      expect(
        reasonsOf((await decisionsOf({ incidentId }))[0]!.entries),
      ).toEqual(LINKED_TO_NOTHING);
    });

    test("AI rules set up, and none matches", async () => {
      const project: SeededProject = await seedProject({ incidents: true });
      const incidentId: ObjectID = await seedIncident(project);
      await database.query(
        `INSERT INTO "${schema}"."AutoRemediationRule"
          ("_id", "projectId", "name", "triggerEntityType", "titlePattern", "version")
         VALUES ($1, $2, 'Payments only', 'Incident', '^Payments', 1)`,
        [ObjectID.generate().toString(), project.projectId.toString()],
      );

      await AutoRemediationRuleEngineService.applyRulesToIncidentById({
        incidentId,
        projectId: project.projectId,
      });

      const entries: Array<AutoRemediationDecisionEntry> = (
        await decisionsOf({ incidentId })
      )[0]!.entries;
      expect(reasonsOf(entries)).toEqual([
        `${AutoRemediationDecisionLane.Rule}:${AutoRemediationDecisionReason.NotMatchedByAnyRule}`,
      ]);
      expect(entries[0]!.rulesChecked).toBe(1);
    });

    test("a matching AI rule that only investigates", async () => {
      const project: SeededProject = await seedProject({ incidents: true });
      const incidentId: ObjectID = await seedIncident(project);
      await database.query(
        `INSERT INTO "${schema}"."AutoRemediationRule"
          ("_id", "projectId", "name", "triggerEntityType", "fixes", "version")
         VALUES ($1, $2, 'Checkout investigations', 'Incident', false, 1)`,
        [ObjectID.generate().toString(), project.projectId.toString()],
      );

      await AutoRemediationRuleEngineService.applyRulesToIncidentById({
        incidentId,
        projectId: project.projectId,
      });

      const entries: Array<AutoRemediationDecisionEntry> = (
        await decisionsOf({ incidentId })
      )[0]!.entries;
      expect(reasonsOf(entries)).toEqual([
        `${AutoRemediationDecisionLane.Rule}:${AutoRemediationDecisionReason.MatchedRulesDoNotFix}`,
      ]);
      expect(entries[0]!.ruleName).toBe("Checkout investigations");
    });
  });

  describe("the cause: decided once, with the settings of that moment - and Try again", () => {
    test("fixing turned on after the incident was declared: it still said off, and Try again decides it again", async () => {
      const project: SeededProject = await seedProject({ incidents: false });
      const incidentId: ObjectID = await seedIncident(project);

      // Declared while fixing was off.
      await AutoRemediationRuleEngineService.applyRulesToIncidentById({
        incidentId,
        projectId: project.projectId,
      });
      await backdateDecisions(5);

      // The maintainer turns fixing on. Nothing reaches back on its own.
      await setSwitch(project, "enableAutomaticIncidentRemediation", true);
      let decisions: Awaited<ReturnType<typeof decisionsOf>> =
        await decisionsOf({ incidentId });
      expect(decisions).toHaveLength(1);
      expect(reasonsOf(decisions[0]!.entries)).toEqual([
        `${AutoRemediationDecisionLane.Project}:${AutoRemediationDecisionReason.RemediationOff}`,
      ]);

      // Try again: decided now, as a new incident would be.
      expect(
        await AutoRemediationRuleEngineService.tryAgain({
          projectId: project.projectId,
          incidentId,
        }),
      ).toBe(RemediationTryAgainResult.Evaluated);

      decisions = await decisionsOf({ incidentId });
      expect(decisions).toHaveLength(2);
      // The old decision is kept; the newest is the one the step shows.
      expect(reasonsOf(decisions[0]!.entries)).toEqual([
        `${AutoRemediationDecisionLane.Project}:${AutoRemediationDecisionReason.RemediationOff}`,
      ]);
      expect(decisions[1]!.stage).toBe(AutoRemediationDecisionStage.Evaluated);
      expect(reasonsOf(decisions[1]!.entries)).toEqual(LINKED_TO_NOTHING);
    });

    test("Try again moments after a decision is refused by the row's own time", async () => {
      const project: SeededProject = await seedProject({ incidents: true });
      const incidentId: ObjectID = await seedIncident(project);

      await AutoRemediationRuleEngineService.applyRulesToIncidentById({
        incidentId,
        projectId: project.projectId,
      });

      expect(
        await AutoRemediationRuleEngineService.tryAgain({
          projectId: project.projectId,
          incidentId,
        }),
      ).toBe(RemediationTryAgainResult.TooSoon);
      expect(await decisionsOf({ incidentId })).toHaveLength(1);
    });

    test("a resolved incident is never decided again", async () => {
      const project: SeededProject = await seedProject({ incidents: true });
      const incidentId: ObjectID = await seedIncident(project, {
        isResolved: true,
      });

      expect(
        await AutoRemediationRuleEngineService.tryAgain({
          projectId: project.projectId,
          incidentId,
        }),
      ).toBe(RemediationTryAgainResult.Resolved);
      expect(await decisionsOf({ incidentId })).toHaveLength(0);
    });

    test("while remediation waits for the investigation, it decides then", async () => {
      const project: SeededProject = await seedProject({ incidents: true });
      const incidentId: ObjectID = await seedIncident(project);
      await AutoRemediationRuleEngineService.recordWaitingForInvestigation({
        projectId: project.projectId,
        incidentId,
      });

      expect(
        await AutoRemediationRuleEngineService.tryAgain({
          projectId: project.projectId,
          incidentId,
        }),
      ).toBe(RemediationTryAgainResult.WaitingForInvestigation);
      expect(await decisionsOf({ incidentId })).toEqual([
        {
          stage: AutoRemediationDecisionStage.WaitingForInvestigation,
          entries: [],
        },
      ]);
    });

    test("a fix waiting for approval is approved or dismissed first", async () => {
      const project: SeededProject = await seedProject({ incidents: true });
      const incidentId: ObjectID = await seedIncident(project);
      await AutoRemediationRuleEngineService.applyRulesToIncidentById({
        incidentId,
        projectId: project.projectId,
      });
      await backdateDecisions(5);
      await database.query(
        `INSERT INTO "${schema}"."AutoRemediationSuggestion"
          ("_id", "projectId", "incidentId", "status", "executionMode", "version")
         VALUES ($1, $2, $3, 'Suggested', 'Suggest', 1)`,
        [
          ObjectID.generate().toString(),
          project.projectId.toString(),
          incidentId.toString(),
        ],
      );

      expect(
        await AutoRemediationRuleEngineService.tryAgain({
          projectId: project.projectId,
          incidentId,
        }),
      ).toBe(RemediationTryAgainResult.FixInProgress);
      expect(await decisionsOf({ incidentId })).toHaveLength(1);
    });

    test("an alert turned on for fixing is decided again as an alert", async () => {
      const project: SeededProject = await seedProject({
        incidents: true,
        alerts: false,
      });
      const alertId: ObjectID = await seedAlert(project);
      await AutoRemediationRuleEngineService.applyRulesToAlertById({
        alertId,
        projectId: project.projectId,
      });
      await backdateDecisions(5);
      await setSwitch(project, "enableAutomaticAlertRemediation", true);

      expect(
        await AutoRemediationRuleEngineService.tryAgain({
          projectId: project.projectId,
          alertId,
        }),
      ).toBe(RemediationTryAgainResult.Evaluated);

      const decisions: Awaited<ReturnType<typeof decisionsOf>> =
        await decisionsOf({ alertId });
      expect(decisions).toHaveLength(2);
      expect(reasonsOf(decisions[1]!.entries)).toEqual(LINKED_TO_NOTHING);
    });
  });

  describe("the fix in the code a recommended investigation leads to", () => {
    async function seedRecommendedInvestigation(
      project: SeededProject,
      incidentId: ObjectID,
    ): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."AIRun"
          ("_id", "projectId", "runType", "status", "triggeredByIncidentId", "codeFixRecommendation", "version")
         VALUES ($1, $2, $3, $4, $5, $6, 1)`,
        [
          id.toString(),
          project.projectId.toString(),
          AIRunType.Investigation,
          AIRunStatus.Completed,
          incidentId.toString(),
          AIRunCodeFixRecommendation.Recommended,
        ],
      );
      return id;
    }

    test("no repository connected: the step to take, and why it did not open on its own", async () => {
      const project: SeededProject = await seedProject({ incidents: true });
      const incidentId: ObjectID = await seedIncident(project);
      await seedRecommendedInvestigation(project, incidentId);

      const suggestion: InvestigationCodeFixSuggestion =
        await FixFromIncidentTaskTrigger.getSuggestionForSubject({
          projectId: project.projectId,
          incidentId,
        });

      expect(suggestion.offer).toBe(SuggestionOffer.SetUp);
      expect(suggestion.blocker).toBeNull();
      expect(suggestion.automaticBlocker).toBe(
        AutomaticCodeFixBlocker.NoRepository,
      );
    });

    test("fixing off: that is why, before the repository", async () => {
      const project: SeededProject = await seedProject({ incidents: false });
      const incidentId: ObjectID = await seedIncident(project);
      await seedRecommendedInvestigation(project, incidentId);

      expect(
        (
          await FixFromIncidentTaskTrigger.getSuggestionForSubject({
            projectId: project.projectId,
            incidentId,
          })
        ).automaticBlocker,
      ).toBe(AutomaticCodeFixBlocker.FixOff);
    });

    test("the pull request OneUptime AI is writing on its own", async () => {
      const project: SeededProject = await seedProject({ incidents: true });
      const incidentId: ObjectID = await seedIncident(project);
      await seedRecommendedInvestigation(project, incidentId);
      const fixId: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."AIRun"
          ("_id", "projectId", "runType", "status", "triggeredByIncidentId", "codeFixTaskType", "version")
         VALUES ($1, $2, $3, $4, $5, $6, 1)`,
        [
          fixId.toString(),
          project.projectId.toString(),
          AIRunType.CodeFix,
          AIRunStatus.Queued,
          incidentId.toString(),
          CodeFixTaskType.FixFromIncident,
        ],
      );

      expect(
        await FixFromIncidentTaskTrigger.getSuggestionForSubject({
          projectId: project.projectId,
          incidentId,
        }),
      ).toEqual({
        offer: SuggestionOffer.InProgress,
        fixOutcome: null,
        blocker: null,
        aiRunId: fixId.toString(),
        isAutomatic: true,
        automaticBlocker: null,
      });
    });

    test("an investigation that recommends no change in the code says nothing", async () => {
      const project: SeededProject = await seedProject({ incidents: true });
      const incidentId: ObjectID = await seedIncident(project);
      await database.query(
        `INSERT INTO "${schema}"."AIRun"
          ("_id", "projectId", "runType", "status", "triggeredByIncidentId", "codeFixRecommendation", "version")
         VALUES ($1, $2, $3, $4, $5, $6, 1)`,
        [
          ObjectID.generate().toString(),
          project.projectId.toString(),
          AIRunType.Investigation,
          AIRunStatus.Completed,
          incidentId.toString(),
          AIRunCodeFixRecommendation.NotRecommended,
        ],
      );

      expect(
        (
          await FixFromIncidentTaskTrigger.getSuggestionForSubject({
            projectId: project.projectId,
            incidentId,
          })
        ).offer,
      ).toBe(SuggestionOffer.None);
    });
  });
});
