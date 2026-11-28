import Entities from "../../../../../Models/DatabaseModels/Index";
import SecurityUserErasureRequest from "../../../../../Models/DatabaseModels/SecurityUserErasureRequest";
import PostgresAppInstance from "../../../../../Server/Infrastructure/PostgresDatabase";
import DatabaseService from "../../../../../Server/Services/DatabaseService";
import SecurityCaseFeedService from "../../../../../Server/Services/SecurityCaseFeedService";
import SecurityUserErasureRequestService, {
  readErasureRequestNames,
  readErasureRequestProgress,
} from "../../../../../Server/Services/SecurityUserErasureRequestService";
import AlertService from "../../../../../Server/Services/AlertService";
import AlertStateService from "../../../../../Server/Services/AlertStateService";
import DetectionRule from "../../../../../Models/DatabaseModels/DetectionRule";
import DetectionFingerprint, {
  DetectionFingerprintKind,
} from "../../../../../Server/Utils/SecurityEvent/DetectionFingerprint";
import DetectionRuleEvaluator from "../../../../../Server/Utils/SecurityEvent/DetectionRuleEvaluator";
import { getEntityRiskFingerprint } from "../../../../../Server/Utils/SecurityEvent/EntityRisk/SecurityEntityRiskCases";
import {
  DedupedRecordOutcome,
  openDedupedAlerts,
} from "../../../../../Server/Utils/SecurityEvent/SecurityEventAlerting";
import { SecurityUserErasureProgress } from "../../../../../Server/Utils/SecurityEvent/UserVault/SecurityUserErasureProgress";
import logger from "../../../../../Server/Utils/Logger";
import SecurityUserErasureRecords, {
  RUN_CANCELLED_FOR_ERASURE_MARKDOWN,
  SecurityUserErasureRecordCounts,
} from "../../../../../Server/Utils/SecurityEvent/UserVault/SecurityUserErasureRecords";
import ScrubHashToken from "../../../../../Server/Utils/Telemetry/ScrubHashToken";
import WorkspaceSecurityPlaybookApprovalMessages from "../../../../../Server/Utils/Workspace/WorkspaceSecurityPlaybookApprovalMessages";
import ObjectID from "../../../../../Types/ObjectID";
import {
  SecurityCaseAiActionReason,
  SecurityCaseAiActionStatus,
} from "../../../../../Types/SecurityCase/SecurityCaseAi";
import { SecurityEntityType } from "../../../../../Types/SecurityCase/SecurityEntity";
import SecurityDetectionSource from "../../../../../Types/SecurityCase/SecurityDetectionSource";
import SecurityPlaybookRunStatus from "../../../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { SecurityUserErasureRequestStatus } from "../../../../../Types/SecurityEvent/SecurityUserErasure";
import {
  detectionRuleMatchMarkdown,
  threatIntelMatchMarkdown,
} from "../../../../../Utils/SecurityCase/SecurityCaseMarkdown";
import { getEntityCaseGroupingKey } from "../../../../../Utils/SecurityCase/SecurityEntityRiskScore";
import { ErasedName } from "../../../../../Utils/SecurityEvent/SecurityUserErasureUnnaming";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

/*
 * The alert path pulls the native isolated-vm addon through its template
 * renderer; stub it out before anything imports it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

/*
 * Erasing one person from Security Events' user vault (#10908), against a
 * real Postgres: what the erasure changes in Postgres, and the requests
 * themselves, through the real SQL and the real services.
 *
 *   - detections: the "<rule> — <name>" title, the group value, the
 *     entities and the kept events get the token - found by the name in a
 *     jsonb column's text, which only a real driver shows - and so does
 *     their description, where OneUptime wrote the name as a value;
 *   - cases: the title, the description, the entities and the grouping
 *     key, written with SQL of their own (so the audit log never keeps the
 *     name);
 *   - entity risk: the person's row deleted, everybody else's kept;
 *   - proposals: an action of OneUptime AI's waiting for approval to act on
 *     them withdrawn (Left, PersonErased), a playbook run waiting for
 *     approval cancelled with its case's feed saying why; finished ones
 *     keep their history, with the token;
 *   - another person, and another project's records about the same person,
 *     stay; running it again changes nothing more;
 *   - a request: what was typed kept encrypted, never in clear, and wiped
 *     once the request is over; the tokens the vault refuses read per
 *     project; the open requests, oldest first.
 *
 * Opt in with RUN_POSTGRES_SECURITY_USER_ERASURE_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check. The tables' STRUCTURE
 * is cloned into a unique schema that is dropped afterwards. Credentials
 * from DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * SECURITY_USER_ERASURE_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * SECURITY_USER_ERASURE_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 */
const describePostgres: (name: string, suite: () => void) => void =
  process.env["RUN_POSTGRES_SECURITY_USER_ERASURE_TESTS"] === "true"
    ? describe
    : describe.skip;

const ALICE: string = "alice@example.com";
const ALICE_IN_AUTH0: string = `auth0|${ALICE}`;
const BOB: string = "bob@example.com";
const ADDRESS: string = "203.0.113.7";

describePostgres("erasing a person from Security Events, in Postgres", () => {
  const schema: string = `security_user_erasure_${ObjectID.generate()
    .toString()
    .split("-")
    .join("")}`;
  let database: DataSource;
  let projectId: ObjectID;
  let otherProjectId: ObjectID;
  let aliceToken: string;
  let names: Array<ErasedName>;
  let feed: Array<Record<string, unknown>>;

  const TABLES: Array<string> = [
    "User",
    "Project",
    "SecurityUserErasureRequest",
    "SecurityCase",
    "SecurityDetection",
    "SecurityEntityRisk",
    "SecurityCaseAiAction",
    "SecurityPlaybookRun",
    // What a detection opened, deduped by its fingerprint (#11130).
    "Alert",
    "Incident",
    // The feed items that announced them, which copy their description (#11230).
    "AlertFeed",
    "IncidentFeed",
  ];

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["SECURITY_USER_ERASURE_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["SECURITY_USER_ERASURE_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["SECURITY_USER_ERASURE_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: {
        options: `-c search_path=${schema}`,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );

      // A fixture names only what the statements touch.
      const columns: Array<{ column_name: string }> = await database.query(
        `SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2 AND is_nullable = 'NO' AND column_name <> '_id'`,
        [schema, table],
      );

      for (const column of columns) {
        await database.query(
          `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
        );
      }
    }

    expect(
      (await database.query("SELECT current_schema()"))[0].current_schema,
    ).toBe(schema);
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    // Live updates and workflows are not what this is about.
    jest
      .spyOn(DatabaseService.prototype, "onTriggerRealtime")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(DatabaseService.prototype, "onTriggerWorkflow")
      .mockResolvedValue(undefined as never);

    // A cancelled run's Slack and Teams messages, and its case's feed: what they are told.
    jest
      .spyOn(WorkspaceSecurityPlaybookApprovalMessages, "refreshInBackground")
      .mockReturnValue(undefined as never);
    feed = [];
    jest
      .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
      .mockImplementation((async (item: Record<string, unknown>) => {
        feed.push(item);
        return undefined;
      }) as never);

    for (const table of [...TABLES].reverse()) {
      await database.query(`DELETE FROM "${schema}"."${table}"`);
    }

    projectId = ObjectID.generate();
    otherProjectId = ObjectID.generate();

    for (const id of [projectId, otherProjectId]) {
      await database.query(
        `INSERT INTO "${schema}"."Project" ("_id", "version", "name") VALUES ($1, 1, $2)`,
        [id.toString(), `Project ${id.toString()}`],
      );
    }

    aliceToken = ScrubHashToken.ofValue({ projectId, value: ALICE });
    names = [
      { named: ALICE, hashed: aliceToken },
      { named: ALICE_IN_AUTH0, hashed: `auth0|${aliceToken}` },
    ];
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function insert(
    table: string,
    row: Record<string, unknown>,
  ): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    const values: Record<string, unknown> = {
      _id: id.toString(),
      version: 1,
      ...row,
    };
    const columns: Array<string> = Object.keys(values);

    await database.query(
      `INSERT INTO "${schema}"."${table}" (${columns
        .map((column: string): string => {
          return `"${column}"`;
        })
        .join(", ")}) VALUES (${columns
        .map((_column: string, index: number): string => {
          return `$${index + 1}`;
        })
        .join(", ")})`,
      columns.map((column: string): unknown => {
        const value: unknown = values[column];

        return value !== null &&
          typeof value === "object" &&
          !(value instanceof Date)
          ? JSON.stringify(value)
          : value;
      }),
    );

    return id;
  }

  async function rowOf(
    table: string,
    id: ObjectID,
  ): Promise<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = await database.query(
      `SELECT * FROM "${schema}"."${table}" WHERE "_id" = $1`,
      [id.toString()],
    );

    expect(rows).toHaveLength(1);

    return rows[0]!;
  }

  function userEntities(user: string): Array<Record<string, string>> {
    return [
      { type: SecurityEntityType.User, value: user },
      { type: SecurityEntityType.IpAddress, value: ADDRESS },
    ];
  }

  describe("detections and cases", () => {
    test("a detection's title, group value, entities and kept events get the token", async () => {
      const caseId: ObjectID = await insert("SecurityCase", {
        projectId: projectId.toString(),
        title: "Brute force — someone else",
      });
      const detectionId: ObjectID = await insert("SecurityDetection", {
        projectId: projectId.toString(),
        securityCaseId: caseId.toString(),
        title: `Repeated failed sign-ins for one account — ${ALICE}`,
        groupValue: ALICE,
        entities: userEntities(ALICE),
        matchedEvents: {
          events: [
            {
              principalUser: ALICE,
              observables: [ALICE, ADDRESS],
              message: `Failed password for ${aliceToken}`,
            },
          ],
        },
      });
      const bobId: ObjectID = await insert("SecurityDetection", {
        projectId: projectId.toString(),
        title: `Repeated failed sign-ins for one account — ${BOB}`,
        groupValue: BOB,
        entities: userEntities(BOB),
      });
      const otherProjectDetectionId: ObjectID = await insert(
        "SecurityDetection",
        {
          projectId: otherProjectId.toString(),
          title: `Repeated failed sign-ins for one account — ${ALICE}`,
          groupValue: ALICE,
          entities: userEntities(ALICE),
        },
      );

      expect(
        await SecurityUserErasureRecords.unnameDetections({
          projectId,
          names,
        }),
      ).toEqual({ caseIds: [caseId.toString()], groupValues: [] });

      const detection: Record<string, unknown> = await rowOf(
        "SecurityDetection",
        detectionId,
      );

      expect(detection["title"]).toBe(
        `Repeated failed sign-ins for one account — ${aliceToken}`,
      );
      expect(detection["groupValue"]).toBe(aliceToken);
      expect(detection["entities"]).toEqual(userEntities(aliceToken));
      expect(detection["matchedEvents"]).toEqual({
        events: [
          {
            principalUser: aliceToken,
            observables: [aliceToken, ADDRESS],
            message: `Failed password for ${aliceToken}`,
          },
        ],
      });
      expect(JSON.stringify(detection)).not.toContain(ALICE);

      expect((await rowOf("SecurityDetection", bobId))["groupValue"]).toBe(BOB);
      expect(
        (await rowOf("SecurityDetection", otherProjectDetectionId))[
          "groupValue"
        ],
      ).toBe(ALICE);
    });

    test("a case's title, entities and grouping key get the token, in SQL of its own", async () => {
      const caseId: ObjectID = await insert("SecurityCase", {
        projectId: projectId.toString(),
        title: `Repeated failed sign-ins for one account — ${ALICE_IN_AUTH0}`,
        entities: userEntities(ALICE_IN_AUTH0),
        groupingKey: getEntityCaseGroupingKey(ALICE),
      });
      const bobCaseId: ObjectID = await insert("SecurityCase", {
        projectId: projectId.toString(),
        title: `Repeated failed sign-ins for one account — ${BOB}`,
        entities: userEntities(BOB),
        groupingKey: getEntityCaseGroupingKey(BOB),
      });
      const otherProjectCaseId: ObjectID = await insert("SecurityCase", {
        projectId: otherProjectId.toString(),
        title: `Repeated failed sign-ins for one account — ${ALICE}`,
        entities: userEntities(ALICE),
      });

      expect(
        await SecurityUserErasureRecords.unnameCases({ projectId, names }),
      ).toEqual([caseId.toString()]);

      const securityCase: Record<string, unknown> = await rowOf(
        "SecurityCase",
        caseId,
      );

      expect(securityCase["title"]).toBe(
        `Repeated failed sign-ins for one account — auth0|${aliceToken}`,
      );
      expect(securityCase["entities"]).toEqual(
        userEntities(`auth0|${aliceToken}`),
      );
      expect(securityCase["groupingKey"]).toBe(
        getEntityCaseGroupingKey(aliceToken),
      );
      expect(securityCase["version"]).toBe(2);
      expect(JSON.stringify(securityCase)).not.toContain(ALICE);

      expect((await rowOf("SecurityCase", bobCaseId))["title"]).toBe(
        `Repeated failed sign-ins for one account — ${BOB}`,
      );
      expect((await rowOf("SecurityCase", otherProjectCaseId))["title"]).toBe(
        `Repeated failed sign-ins for one account — ${ALICE}`,
      );
    });

    test("a detection's description, and the case's it opened, get the token where OneUptime wrote the name as a value", async () => {
      /*
       * What DetectionRuleEvaluator writes about a user: the correlation's
       * sentence, then the observables. Written about the token, it is what
       * the erasure must leave.
       */
      const description: (user: string) => string = (user: string): string => {
        return detectionRuleMatchMarkdown({
          ruleName: "New account on a server",
          matchCount: 3,
          windowStart: "2026-11-24T09:00:00Z",
          windowEnd: "2026-11-24T09:15:00Z",
          correlationSummary: `First principalUser in 7 days: ${user}, ${BOB}`,
          sampleMessage: `Accepted password for ${aliceToken}`,
          observables: [user, ADDRESS],
        }).toString();
      };

      // Nothing but the description names her: it alone finds them.
      const caseId: ObjectID = await insert("SecurityCase", {
        projectId: projectId.toString(),
        title: "New accounts on the build servers",
        description: description(ALICE),
      });
      const detectionId: ObjectID = await insert("SecurityDetection", {
        projectId: projectId.toString(),
        securityCaseId: caseId.toString(),
        title: "New account on a server",
        description: description(ALICE),
      });
      // Only in other words, as a person would write it: stays.
      const peopleCaseId: ObjectID = await insert("SecurityCase", {
        projectId: projectId.toString(),
        title: "Ask the help desk",
        description: `Call ${ALICE} about her sign-ins. What happened: she lost her phone.`,
      });

      expect(
        await SecurityUserErasureRecords.unnameDetections({ projectId, names }),
      ).toEqual({ caseIds: [caseId.toString()], groupValues: [] });
      expect(
        await SecurityUserErasureRecords.unnameCases({ projectId, names }),
      ).toEqual([caseId.toString()]);

      const unnamed: string = description(aliceToken);

      expect(unnamed).toContain(`: \\${aliceToken.slice(0, -1)}\\], ${BOB}.`);
      expect(
        (await rowOf("SecurityDetection", detectionId))["description"],
      ).toBe(unnamed);

      const securityCase: Record<string, unknown> = await rowOf(
        "SecurityCase",
        caseId,
      );

      expect(securityCase["description"]).toBe(unnamed);
      expect(securityCase["version"]).toBe(2);
      expect(JSON.stringify(securityCase)).not.toContain(ALICE);
      // Another user the sentence lists keeps their name.
      expect(securityCase["description"]).toContain(`, ${BOB}.`);

      expect((await rowOf("SecurityCase", peopleCaseId))["version"]).toBe(1);

      // Done again, nothing more is found.
      expect(
        await SecurityUserErasureRecords.unnameDetections({ projectId, names }),
      ).toEqual({ caseIds: [], groupValues: [] });
      expect(
        await SecurityUserErasureRecords.unnameCases({ projectId, names }),
      ).toEqual([]);
    });

    test("a case that only mentions the name in other words is left as people wrote it", async () => {
      const caseId: ObjectID = await insert("SecurityCase", {
        projectId: projectId.toString(),
        title: `Look at ${ALICE}'s sign-ins with the help desk`,
        entities: userEntities(BOB),
      });

      expect(
        await SecurityUserErasureRecords.unnameCases({ projectId, names }),
      ).toEqual([]);
      expect((await rowOf("SecurityCase", caseId))["version"]).toBe(1);
    });
  });

  test("the person's entity risk rows are deleted, everybody else's kept", async () => {
    const aliceRisk: ObjectID = await insert("SecurityEntityRisk", {
      projectId: projectId.toString(),
      entityType: SecurityEntityType.User,
      entityValue: "Alice@Example.com",
      entityKey: ALICE,
      riskScore: 80,
    });
    const bobRisk: ObjectID = await insert("SecurityEntityRisk", {
      projectId: projectId.toString(),
      entityType: SecurityEntityType.User,
      entityValue: BOB,
      entityKey: BOB,
      riskScore: 40,
    });
    const otherProjectRisk: ObjectID = await insert("SecurityEntityRisk", {
      projectId: otherProjectId.toString(),
      entityType: SecurityEntityType.User,
      entityValue: ALICE,
      entityKey: ALICE,
      riskScore: 10,
    });

    await SecurityUserErasureRecords.deleteEntityRisk({ projectId, names });

    expect(
      await database.query(
        `SELECT "_id" FROM "${schema}"."SecurityEntityRisk" WHERE "_id" = $1`,
        [aliceRisk.toString()],
      ),
    ).toEqual([]);
    expect((await rowOf("SecurityEntityRisk", bobRisk))["riskScore"]).toBe(40);
    expect(
      (await rowOf("SecurityEntityRisk", otherProjectRisk))["riskScore"],
    ).toBe(10);
  });

  describe("proposals to act on the person", () => {
    test("an action of OneUptime AI's waiting for approval is withdrawn; a done one keeps its history with the token", async () => {
      const caseId: ObjectID = await insert("SecurityCase", {
        projectId: projectId.toString(),
        title: "Brute force",
      });
      const asked: ObjectID = await insert("SecurityCaseAiAction", {
        projectId: projectId.toString(),
        securityCaseId: caseId.toString(),
        status: SecurityCaseAiActionStatus.Asked,
        reason: SecurityCaseAiActionReason.SettingAsks,
        target: ALICE,
        evidence: { user: ALICE, address: ADDRESS },
      });
      const done: ObjectID = await insert("SecurityCaseAiAction", {
        projectId: projectId.toString(),
        securityCaseId: caseId.toString(),
        status: SecurityCaseAiActionStatus.Done,
        reason: SecurityCaseAiActionReason.Approved,
        target: ALICE,
      });
      const bob: ObjectID = await insert("SecurityCaseAiAction", {
        projectId: projectId.toString(),
        securityCaseId: caseId.toString(),
        status: SecurityCaseAiActionStatus.Asked,
        reason: SecurityCaseAiActionReason.SettingAsks,
        target: BOB,
      });

      expect(
        await SecurityUserErasureRecords.withdrawAiActions({
          projectId,
          names,
        }),
      ).toBe(1);

      const withdrawn: Record<string, unknown> = await rowOf(
        "SecurityCaseAiAction",
        asked,
      );

      expect(withdrawn["status"]).toBe(SecurityCaseAiActionStatus.Left);
      expect(withdrawn["reason"]).toBe(SecurityCaseAiActionReason.PersonErased);
      expect(withdrawn["target"]).toBe(aliceToken);
      expect(withdrawn["evidence"]).toEqual({
        user: aliceToken,
        address: ADDRESS,
      });
      expect(withdrawn["decidedAt"]).toBeInstanceOf(Date);

      const kept: Record<string, unknown> = await rowOf(
        "SecurityCaseAiAction",
        done,
      );

      expect(kept["status"]).toBe(SecurityCaseAiActionStatus.Done);
      expect(kept["target"]).toBe(aliceToken);

      expect((await rowOf("SecurityCaseAiAction", bob))["status"]).toBe(
        SecurityCaseAiActionStatus.Asked,
      );
    });

    test("a playbook run waiting for approval is cancelled, its case told why; a finished one keeps its results with the token", async () => {
      const caseId: ObjectID = await insert("SecurityCase", {
        projectId: projectId.toString(),
        title: "Brute force",
      });
      const stepResults: Array<Record<string, unknown>> = [
        {
          stepId: "suspend",
          approval: { targets: [ALICE] },
          targets: [
            {
              type: SecurityEntityType.User,
              value: ALICE,
              reason: "Actor",
              state: "Waiting",
            },
          ],
        },
      ];
      const waiting: ObjectID = await insert("SecurityPlaybookRun", {
        projectId: projectId.toString(),
        securityCaseId: caseId.toString(),
        playbookName: "Suspend the account",
        status: SecurityPlaybookRunStatus.WaitingForApproval,
        stepResults,
      });
      const finished: ObjectID = await insert("SecurityPlaybookRun", {
        projectId: projectId.toString(),
        securityCaseId: caseId.toString(),
        playbookName: "Suspend the account",
        status: SecurityPlaybookRunStatus.Succeeded,
        stepResults,
      });
      const bobs: ObjectID = await insert("SecurityPlaybookRun", {
        projectId: projectId.toString(),
        securityCaseId: caseId.toString(),
        playbookName: "Suspend the account",
        status: SecurityPlaybookRunStatus.WaitingForApproval,
        stepResults: [{ stepId: "suspend", approval: { targets: [BOB] } }],
      });

      expect(
        await SecurityUserErasureRecords.withdrawPlaybookRuns({
          projectId,
          names,
        }),
      ).toBe(1);

      const cancelled: Record<string, unknown> = await rowOf(
        "SecurityPlaybookRun",
        waiting,
      );

      expect(cancelled["status"]).toBe(SecurityPlaybookRunStatus.Cancelled);
      expect(cancelled["completedAt"]).toBeInstanceOf(Date);
      expect(JSON.stringify(cancelled["stepResults"])).not.toContain(ALICE);
      expect(JSON.stringify(cancelled["stepResults"])).toContain(aliceToken);
      expect(feed).toHaveLength(1);
      expect(feed[0]!["moreInformationInMarkdown"]).toBe(
        RUN_CANCELLED_FOR_ERASURE_MARKDOWN,
      );
      expect(String(feed[0]!["securityCaseId"])).toBe(caseId.toString());

      const kept: Record<string, unknown> = await rowOf(
        "SecurityPlaybookRun",
        finished,
      );

      expect(kept["status"]).toBe(SecurityPlaybookRunStatus.Succeeded);
      expect(JSON.stringify(kept["stepResults"])).not.toContain(ALICE);

      expect((await rowOf("SecurityPlaybookRun", bobs))["status"]).toBe(
        SecurityPlaybookRunStatus.WaitingForApproval,
      );
    });

    test("a step's summary that names the person as inline code - a threat intel lookup's - gets the token too, a person's words do not (#11230)", async () => {
      const summary: (value: string) => string = (value: string): string => {
        return `1 entity is known-bad in threat intel: \`${value}\`.`;
      };
      const finished: ObjectID = await insert("SecurityPlaybookRun", {
        projectId: projectId.toString(),
        playbookName: "Look up the account",
        status: SecurityPlaybookRunStatus.Succeeded,
        stepResults: [
          {
            stepId: "lookup",
            summaryInMarkdown: summary(ALICE),
            detailsInMarkdown: `- \`${ALICE}\`: email-addr, feed **Acme**, confidence 80`,
          },
          // A person's own words keep what they wrote.
          { stepId: "note", note: `Ask ${ALICE} about it` },
        ],
      });

      await SecurityUserErasureRecords.withdrawPlaybookRuns({
        projectId,
        names,
      });

      const results: Array<Record<string, unknown>> = (
        await rowOf("SecurityPlaybookRun", finished)
      )["stepResults"] as Array<Record<string, unknown>>;

      expect(results[0]!["summaryInMarkdown"]).toBe(summary(aliceToken));
      expect(results[0]!["detailsInMarkdown"]).toBe(
        `- \`${aliceToken}\`: email-addr, feed **Acme**, confidence 80`,
      );
      expect(results[1]!["note"]).toBe(`Ask ${ALICE} about it`);

      // Done again, nothing more is found to change.
      const version: unknown = (await rowOf("SecurityPlaybookRun", finished))[
        "version"
      ];

      await SecurityUserErasureRecords.withdrawPlaybookRuns({
        projectId,
        names,
      });

      expect((await rowOf("SecurityPlaybookRun", finished))["version"]).toBe(
        version,
      );
    });
  });

  test("all of it at once, then again: the second run changes nothing more", async () => {
    const caseId: ObjectID = await insert("SecurityCase", {
      projectId: projectId.toString(),
      title: `Brute force — ${ALICE}`,
      entities: userEntities(ALICE),
    });
    await insert("SecurityDetection", {
      projectId: projectId.toString(),
      securityCaseId: caseId.toString(),
      title: `Brute force — ${ALICE}`,
      groupValue: ALICE,
      entities: userEntities(ALICE),
    });
    await insert("SecurityCaseAiAction", {
      projectId: projectId.toString(),
      securityCaseId: caseId.toString(),
      status: SecurityCaseAiActionStatus.Asked,
      target: ALICE,
    });

    const first: SecurityUserErasureRecordCounts =
      await SecurityUserErasureRecords.unnameRecords({ projectId, names });

    expect(first).toEqual({ cases: 1, proposals: 1 });

    const after: Array<Record<string, unknown>> = await database.query(
      `SELECT "title", "entities", "version" FROM "${schema}"."SecurityCase" ORDER BY "_id"`,
    );

    expect(
      await SecurityUserErasureRecords.unnameRecords({ projectId, names }),
    ).toEqual({ cases: 0, proposals: 0 });
    expect(
      await database.query(
        `SELECT "title", "entities", "version" FROM "${schema}"."SecurityCase" ORDER BY "_id"`,
      ),
    ).toEqual(after);
  });

  test("with no name to take out, nothing is read or written", async () => {
    const query: ReturnType<typeof jest.spyOn> = jest.spyOn(database, "query");

    expect(
      await SecurityUserErasureRecords.unnameRecords({
        projectId,
        names: [{ named: aliceToken, hashed: aliceToken }],
      }),
    ).toEqual({ cases: 0, proposals: 0 });
    expect(query).not.toHaveBeenCalled();
  });

  /*
   * #11130: the fingerprint of the value a rule grouped on, or a feed's
   * indicator, is carried by a detection (its own, its finding's id, the
   * firings it took), an alert, an incident and the firings an entity's risk
   * counted. Each of a value that named the person becomes the keyed one of
   * the value with the names out - exactly what the rule makes when it fires
   * on the token, so an open alert goes on taking its group's firings - and
   * nothing stored is a fingerprint of the person, keyed or not.
   */
  describe("the fingerprints of what named the person (#11130)", () => {
    const RULE_ID: ObjectID = new ObjectID(
      "11130000-0000-4000-8000-0000000000b1",
    );
    const FEED_ID: ObjectID = new ObjectID(
      "11130000-0000-4000-8000-0000000000c1",
    );
    const OPEN_STATE_ID: ObjectID = new ObjectID(
      "11130000-0000-4000-8000-0000000000e1",
    );
    const CORRELATION: string = `${ALICE} / ${ADDRESS}`;

    function keyed(value: string, kind?: DetectionFingerprintKind): string {
      return DetectionFingerprint.of({
        projectId,
        kind: kind || DetectionFingerprintKind.DetectionRule,
        value,
      });
    }

    function legacy(value: string, kind?: DetectionFingerprintKind): string {
      return DetectionFingerprint.legacyOf({
        kind: kind || DetectionFingerprintKind.DetectionRule,
        value,
      });
    }

    function ofRule(fingerprint: string): string {
      return `detection-rule:${RULE_ID.toString()}:${fingerprint}`;
    }

    function ofFeed(fingerprint: string): string {
      return `threat-intel:${FEED_ID.toString()}:${fingerprint}`;
    }

    function findingUid(fingerprint: string): string {
      return `detection:${RULE_ID.toString()}:${ofRule(fingerprint)}:run:1764000000000:each:${fingerprint}`;
    }

    function firingKey(fingerprint: string, stretch: number = 1): string {
      return `run:${1764000000000 + stretch}:each:${fingerprint}`;
    }

    function rule(): DetectionRule {
      const detectionRule: DetectionRule = new DetectionRule();

      detectionRule._id = RULE_ID.toString();
      detectionRule.projectId = projectId;

      return detectionRule;
    }

    async function detection(row: Record<string, unknown>): Promise<ObjectID> {
      return await insert("SecurityDetection", {
        projectId: projectId.toString(),
        ...row,
      });
    }

    async function alert(
      seriesFingerprint: string,
      row: Record<string, unknown> = {},
    ): Promise<ObjectID> {
      return await insert("Alert", {
        projectId: projectId.toString(),
        title: `[Detection] Brute force — ${ALICE}`,
        seriesFingerprint,
        currentAlertStateId: OPEN_STATE_ID.toString(),
        ...row,
      });
    }

    async function incident(seriesFingerprint: string): Promise<ObjectID> {
      return await insert("Incident", {
        projectId: projectId.toString(),
        title: `[Detection] Brute force — ${ALICE}`,
        seriesFingerprint,
      });
    }

    async function seriesFingerprintOf(
      table: string,
      id: ObjectID,
    ): Promise<unknown> {
      return (await rowOf(table, id))["seriesFingerprint"];
    }

    // Every row of the project's tables a fingerprint is kept in, as text.
    async function everythingKept(): Promise<string> {
      const kept: Array<unknown> = [];

      for (const table of [
        "SecurityDetection",
        "SecurityCase",
        "SecurityEntityRisk",
      ]) {
        kept.push(
          ...(await database.query(
            `SELECT * FROM "${schema}"."${table}" WHERE "projectId" = $1`,
            [projectId.toString()],
          )),
        );
      }

      // An alert's and an incident's title are theirs to change: their fingerprint is not.
      for (const table of ["Alert", "Incident"]) {
        kept.push(
          ...(await database.query(
            `SELECT "seriesFingerprint" FROM "${schema}"."${table}" WHERE "projectId" = $1`,
            [projectId.toString()],
          )),
        );
      }

      return JSON.stringify(kept);
    }

    test("a detection's own, its finding's id and its firings, an alert's, an incident's: each of a name becomes the token's", async () => {
      const aliceDetection: ObjectID = await detection({
        title: `Brute force — ${ALICE}`,
        groupValue: ALICE,
        entities: userEntities(ALICE),
        fingerprint: ofRule(legacy(ALICE)),
        eventUid: findingUid(legacy(ALICE)),
        recentFiringKeys: [
          firingKey(legacy(ALICE)),
          firingKey(keyed(ALICE)),
          firingKey(keyed(ALICE), 2),
        ],
      });
      const riskDetection: ObjectID = await detection({
        title: `High risk — ${ALICE}`,
        groupValue: ALICE,
        fingerprint: getEntityRiskFingerprint(ALICE),
      });
      const bobDetection: ObjectID = await detection({
        title: `Brute force — ${BOB}`,
        groupValue: BOB,
        fingerprint: ofRule(legacy(BOB)),
        eventUid: findingUid(legacy(BOB)),
        recentFiringKeys: [firingKey(legacy(BOB))],
      });
      const ungrouped: ObjectID = await detection({
        title: "Brute force",
        fingerprint: ofRule(legacy("")),
        eventUid: findingUid(legacy("")),
      });

      const openAlice: ObjectID = await alert(ofRule(legacy(ALICE)));
      const resolvedAlice: ObjectID = await alert(ofRule(keyed(ALICE)), {
        currentAlertStateId: ObjectID.generate().toString(),
      });
      const auth0Alice: ObjectID = await alert(ofRule(legacy(ALICE_IN_AUTH0)));
      const feedAlice: ObjectID = await alert(
        ofFeed(legacy(ALICE, DetectionFingerprintKind.ThreatIntel)),
      );
      const bobAlert: ObjectID = await alert(ofRule(legacy(BOB)));
      const overflow: ObjectID = await alert(
        `detection-rule:${RULE_ID.toString()}:overflow`,
      );
      const otherProject: ObjectID = await insert("Alert", {
        projectId: otherProjectId.toString(),
        seriesFingerprint: ofRule(legacy(ALICE)),
      });
      const aliceIncident: ObjectID = await incident(ofRule(keyed(ALICE)));
      const bobIncident: ObjectID = await incident(ofRule(keyed(BOB)));

      const before: Record<string, unknown> = await rowOf("Alert", openAlice);

      await SecurityUserErasureRecords.unnameRecords({ projectId, names });

      const aliceRow: Record<string, unknown> = await rowOf(
        "SecurityDetection",
        aliceDetection,
      );

      expect(aliceRow["fingerprint"]).toBe(ofRule(keyed(aliceToken)));
      expect(aliceRow["eventUid"]).toBe(findingUid(keyed(aliceToken)));
      // Both names of the one firing are its one name now; the other firing keeps its own.
      expect(aliceRow["recentFiringKeys"]).toEqual([
        firingKey(keyed(aliceToken)),
        firingKey(keyed(aliceToken), 2),
      ]);
      expect(
        (await rowOf("SecurityDetection", riskDetection))["fingerprint"],
      ).toBe(getEntityRiskFingerprint(aliceToken));

      // Every alert and incident of a name, open or resolved, a rule's or a feed's.
      expect(await seriesFingerprintOf("Alert", openAlice)).toBe(
        ofRule(keyed(aliceToken)),
      );
      expect(await seriesFingerprintOf("Alert", resolvedAlice)).toBe(
        ofRule(keyed(aliceToken)),
      );
      expect(await seriesFingerprintOf("Alert", auth0Alice)).toBe(
        ofRule(keyed(`auth0|${aliceToken}`)),
      );
      expect(await seriesFingerprintOf("Alert", feedAlice)).toBe(
        ofFeed(keyed(aliceToken, DetectionFingerprintKind.ThreatIntel)),
      );
      expect(await seriesFingerprintOf("Incident", aliceIncident)).toBe(
        ofRule(keyed(aliceToken)),
      );

      // Nothing else about the alert changed: its title is people's, its history its own.
      const after: Record<string, unknown> = await rowOf("Alert", openAlice);

      expect({ ...after, seriesFingerprint: null }).toEqual({
        ...before,
        seriesFingerprint: null,
      });

      // Somebody else's, a group of nothing, an overflow, another project's: as they were.
      expect(
        (await rowOf("SecurityDetection", bobDetection))["fingerprint"],
      ).toBe(ofRule(legacy(BOB)));
      expect((await rowOf("SecurityDetection", ungrouped))["eventUid"]).toBe(
        findingUid(legacy("")),
      );
      expect(await seriesFingerprintOf("Alert", bobAlert)).toBe(
        ofRule(legacy(BOB)),
      );
      expect(await seriesFingerprintOf("Alert", overflow)).toBe(
        `detection-rule:${RULE_ID.toString()}:overflow`,
      );
      expect(await seriesFingerprintOf("Alert", otherProject)).toBe(
        ofRule(legacy(ALICE)),
      );
      expect(await seriesFingerprintOf("Incident", bobIncident)).toBe(
        ofRule(keyed(BOB)),
      );
    });

    test("a correlation's value: its detection, its case, its alert and the risk beside it, each with the names out", async () => {
      const unnamedValue: string = `${aliceToken} / ${ADDRESS}`;
      const caseId: ObjectID = await insert("SecurityCase", {
        projectId: projectId.toString(),
        title: `New place for an account — ${CORRELATION}`,
        groupingKey: getEntityCaseGroupingKey(CORRELATION),
      });
      const correlation: ObjectID = await detection({
        securityCaseId: caseId.toString(),
        title: `New place for an account — ${CORRELATION}`,
        groupValue: CORRELATION,
        entities: userEntities(ALICE),
        fingerprint: ofRule(legacy(CORRELATION)),
        eventUid: findingUid(legacy(CORRELATION)),
        recentFiringKeys: [firingKey(legacy(CORRELATION))],
      });
      const correlationAlert: ObjectID = await alert(
        ofRule(keyed(CORRELATION)),
      );
      // The address's risk counted the firing: its row is not the person's.
      const addressRisk: ObjectID = await insert("SecurityEntityRisk", {
        projectId: projectId.toString(),
        entityKey: ADDRESS,
        entityValue: ADDRESS,
        contributions: [
          {
            sourceKey: `rule:${RULE_ID.toString()}`,
            firingKeys: [
              firingKey(legacy(CORRELATION)),
              firingKey(legacy(BOB)),
            ],
          },
        ],
      });

      // Found before anything changes, and kept with the names.
      const values: Array<ErasedName> =
        await SecurityUserErasureRecords.findCorrelationValues({
          projectId,
          names,
        });

      expect(values).toEqual([{ named: CORRELATION, hashed: unnamedValue }]);

      /*
       * A run that un-named the detection and stopped before its
       * fingerprints: the detection no longer says what its value was, so
       * the next run finds it by the value kept with the names.
       */
      expect(
        await SecurityUserErasureRecords.unnameDetections({ projectId, names }),
      ).toEqual({
        caseIds: [caseId.toString()],
        groupValues: [{ named: CORRELATION, hashed: unnamedValue }],
      });
      expect(
        await SecurityUserErasureRecords.findCorrelationValues({
          projectId,
          names,
        }),
      ).toEqual([]);

      await SecurityUserErasureRecords.unnameRecords({
        projectId,
        names: [...names, ...values],
      });

      const row: Record<string, unknown> = await rowOf(
        "SecurityDetection",
        correlation,
      );

      expect(row["groupValue"]).toBe(unnamedValue);
      expect(row["title"]).toBe(`New place for an account — ${unnamedValue}`);
      expect(row["fingerprint"]).toBe(ofRule(keyed(unnamedValue)));
      expect(row["eventUid"]).toBe(findingUid(keyed(unnamedValue)));
      expect(row["recentFiringKeys"]).toEqual([firingKey(keyed(unnamedValue))]);

      const securityCase: Record<string, unknown> = await rowOf(
        "SecurityCase",
        caseId,
      );

      expect(securityCase["title"]).toBe(
        `New place for an account — ${unnamedValue}`,
      );
      expect(securityCase["groupingKey"]).toBe(
        getEntityCaseGroupingKey(unnamedValue),
      );
      expect(await seriesFingerprintOf("Alert", correlationAlert)).toBe(
        ofRule(keyed(unnamedValue)),
      );
      expect(
        (await rowOf("SecurityEntityRisk", addressRisk))["contributions"],
      ).toEqual([
        {
          sourceKey: `rule:${RULE_ID.toString()}`,
          firingKeys: [firingKey(keyed(unnamedValue)), firingKey(legacy(BOB))],
        },
      ]);
    });

    test("an alert open under a name takes the next firing about the token: the fingerprint is the one the rule makes", async () => {
      const openAlice: ObjectID = await alert(ofRule(legacy(ALICE)));

      jest
        .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
        .mockResolvedValue([OPEN_STATE_ID]);
      const create: ReturnType<typeof jest.spyOn> = jest
        .spyOn(AlertService, "create")
        .mockRejectedValue(new Error("nothing should open") as never);

      const fire: (groupValue: string) => Promise<Array<string>> = async (
        groupValue: string,
      ): Promise<Array<string>> => {
        const seen: Array<string> = [];

        expect(
          await openDedupedAlerts({
            projectId,
            alertSeverityId: ObjectID.generate(),
            logLabel: "test",
            matches: [
              {
                ...DetectionRuleEvaluator.buildFingerprints(rule(), groupValue),
                title: "t",
                description: "d",
                rootCause: "r",
              },
            ],
            onOutcome: (outcome: DedupedRecordOutcome): void => {
              seen.push(outcome.recordId.toString());
            },
          }),
        ).toBe(0);

        return seen;
      };

      // Before the erasure, across #11130: a firing about the name finds it by its unkeyed fingerprint.
      expect(await fire(ALICE)).toEqual([openAlice.toString()]);

      await SecurityUserErasureRecords.unnameRecords({ projectId, names });

      // After it: the rule fires on the token, and finds the same alert.
      expect(await fire(aliceToken)).toEqual([openAlice.toString()]);
      expect(await seriesFingerprintOf("Alert", openAlice)).toBe(
        DetectionRuleEvaluator.buildFingerprints(rule(), aliceToken)
          .fingerprint,
      );
      expect(create).not.toHaveBeenCalled();
    });

    test("running it again changes nothing", async () => {
      await detection({
        title: `Brute force — ${ALICE}`,
        groupValue: ALICE,
        fingerprint: ofRule(legacy(ALICE)),
        eventUid: findingUid(legacy(ALICE)),
        recentFiringKeys: [firingKey(legacy(ALICE))],
      });
      await detection({
        title: `New place — ${CORRELATION}`,
        groupValue: CORRELATION,
        entities: userEntities(ALICE),
        fingerprint: ofRule(legacy(CORRELATION)),
      });
      await alert(ofRule(legacy(ALICE)));
      await incident(ofRule(keyed(CORRELATION)));

      await SecurityUserErasureRecords.unnameRecords({ projectId, names });

      const once: string = await everythingKept();
      const versions: string = JSON.stringify(
        await database.query(
          `SELECT "_id", "version", "updatedAt" FROM "${schema}"."SecurityDetection" ORDER BY "_id"`,
        ),
      );

      expect(
        await SecurityUserErasureRecords.rewriteFingerprints({
          projectId,
          groupValues: [
            ...names,
            { named: CORRELATION, hashed: `${aliceToken} / ${ADDRESS}` },
          ],
        }),
      ).toEqual({ detections: 0, alerts: 0, incidents: 0, entityRisks: 0 });

      await SecurityUserErasureRecords.unnameRecords({ projectId, names });

      expect(await everythingKept()).toBe(once);
      expect(
        JSON.stringify(
          await database.query(
            `SELECT "_id", "version", "updatedAt" FROM "${schema}"."SecurityDetection" ORDER BY "_id"`,
          ),
        ),
      ).toBe(versions);
    });

    test("nothing kept lets a guessed name be confirmed: no fingerprint of any spelling, keyed or not, of either source", async () => {
      const caseId: ObjectID = await insert("SecurityCase", {
        projectId: projectId.toString(),
        title: `Brute force — ${ALICE}`,
        groupingKey: getEntityCaseGroupingKey(ALICE),
        entities: userEntities(ALICE),
      });

      await detection({
        securityCaseId: caseId.toString(),
        title: `Brute force — ${ALICE}`,
        groupValue: ALICE,
        entities: userEntities(ALICE),
        fingerprint: ofRule(legacy(ALICE)),
        eventUid: findingUid(legacy(ALICE)),
        recentFiringKeys: [firingKey(legacy(ALICE)), firingKey(keyed(ALICE))],
      });
      await detection({
        title: `High risk — ${ALICE}`,
        groupValue: ALICE,
        fingerprint: getEntityRiskFingerprint(ALICE),
      });
      await detection({
        title: `New place — ${CORRELATION}`,
        groupValue: CORRELATION,
        entities: userEntities(ALICE),
        fingerprint: ofRule(legacy(CORRELATION)),
        eventUid: findingUid(legacy(CORRELATION)),
        recentFiringKeys: [firingKey(legacy(CORRELATION))],
      });
      await alert(ofRule(legacy(ALICE)));
      await alert(ofRule(keyed(ALICE)));
      await alert(ofRule(legacy(ALICE_IN_AUTH0)));
      await alert(ofRule(keyed(CORRELATION)));
      await alert(ofFeed(legacy(ALICE, DetectionFingerprintKind.ThreatIntel)));
      await incident(ofRule(keyed(ALICE)));
      await insert("SecurityEntityRisk", {
        projectId: projectId.toString(),
        entityKey: ALICE,
        entityValue: ALICE,
      });
      await insert("SecurityEntityRisk", {
        projectId: projectId.toString(),
        entityKey: ADDRESS,
        entityValue: ADDRESS,
        contributions: [
          {
            sourceKey: `rule:${RULE_ID.toString()}`,
            firingKeys: [firingKey(legacy(CORRELATION))],
          },
        ],
      });

      const guesses: Array<string> = [
        ALICE,
        "Alice@Example.com",
        "ALICE@EXAMPLE.COM",
        ALICE_IN_AUTH0,
        CORRELATION,
      ];
      const fingerprintsOf: () => Array<string> = (): Array<string> => {
        const all: Array<string> = [];

        for (const guess of guesses) {
          for (const kind of [
            DetectionFingerprintKind.DetectionRule,
            DetectionFingerprintKind.ThreatIntel,
          ]) {
            all.push(keyed(guess, kind), legacy(guess, kind));
          }
        }

        return all;
      };

      // Before: every one of them can be found.
      const before: string = await everythingKept();

      expect(
        fingerprintsOf().filter((fingerprint: string): boolean => {
          return before.includes(fingerprint);
        }).length,
      ).toBeGreaterThan(0);

      await SecurityUserErasureRecords.unnameRecords({ projectId, names });

      const after: string = await everythingKept();

      for (const fingerprint of fingerprintsOf()) {
        expect(after).not.toContain(fingerprint);
      }

      // Nor the name itself, in anything Security Events keeps of it.
      expect(after.toLowerCase()).not.toContain(ALICE);
    });

    /*
     * #11230: a threat intel feed lists the person's address, and keeps it
     * in clear beside its indicator's STIX id and name. What OneUptime wrote
     * about the match named the indicator by both; written here by the same
     * builders the matcher writes with.
     */
    describe("a threat intel feed's indicator (#11230)", () => {
      const STIX_ID: string = "indicator--8e2e2d2b-17d4-4cbf-938f-98ee46b3cd3f";
      const BOB_STIX_ID: string =
        "indicator--0b0b0b0b-0000-4000-8000-00000000b0b0";
      const INDICATOR_NAME: string = `Phishing sender ${ALICE}`;
      const FEED_NAME: string = "Acme Phishing Senders";

      // The id that takes the indicator's place: the match's keyed fingerprint, on the token.
      function erasedIdOf(token: string): string {
        return `[INDICATOR:${keyed(token, DetectionFingerprintKind.ThreatIntel)}]`;
      }

      // A detection's description, and its case's, as the matcher writes them.
      function matchDescription(
        value: string,
        stixId: string = STIX_ID,
        indicatorName: string = INDICATOR_NAME,
      ): string {
        return threatIntelMatchMarkdown({
          feedName: FEED_NAME,
          indicatorName,
          indicatorValue: value,
          indicatorType: "email-addr",
          confidence: 80,
          matchCount: 2,
          windowStart: "2026-11-24T09:00:00Z",
          windowEnd: "2026-11-24T09:15:00Z",
          stixId,
          sampleMessage: `Sign-in from ${ADDRESS}`,
        }).toString();
      }

      // An alert's description, as ThreatIntelMatcher.buildMatchDescription writes it.
      function alertDescription(
        value: string,
        stixId: string = STIX_ID,
      ): string {
        return [
          INDICATOR_NAME,
          `Indicator ${value} (email-addr, confidence 80) matched 2 security events between A and B.`,
          `STIX indicator: ${stixId}`,
          `Sample event: Sign-in from ${ADDRESS}`,
          `Observables: ${value}, ${ADDRESS}`,
        ].join("\n\n");
      }

      async function feedItem(
        table: "AlertFeed" | "IncidentFeed",
        recordId: ObjectID,
        description: string,
      ): Promise<ObjectID> {
        return await insert(table, {
          projectId: projectId.toString(),
          [table === "AlertFeed" ? "alertId" : "incidentId"]:
            recordId.toString(),
          feedInfoInMarkdown: `#### 🚨 Created:\n\n**[Threat Intel] ${FEED_NAME} — ${ALICE}**:\n\n${description}\n\n🔴 **State**: Created`,
        });
      }

      test("a detection's description, and the case's it opened: the erased indicator id for the STIX id, and the indicator's name gone", async () => {
        const caseId: ObjectID = await insert("SecurityCase", {
          projectId: projectId.toString(),
          title: `${FEED_NAME} — ${ALICE}`,
          description: matchDescription(ALICE),
          entities: userEntities(ALICE),
        });
        const detectionId: ObjectID = await detection({
          securityCaseId: caseId.toString(),
          source: SecurityDetectionSource.ThreatIntel,
          title: `${FEED_NAME} — ${ALICE}`,
          description: matchDescription(ALICE),
          groupValue: ALICE,
          ruleName: FEED_NAME,
          fingerprint: ofFeed(
            keyed(ALICE, DetectionFingerprintKind.ThreatIntel),
          ),
        });
        // Somebody else's match keeps the feed's indicator.
        const bobId: ObjectID = await detection({
          source: SecurityDetectionSource.ThreatIntel,
          title: `${FEED_NAME} — ${BOB}`,
          description: matchDescription(BOB, BOB_STIX_ID, "Phishing sender"),
          groupValue: BOB,
          fingerprint: ofFeed(keyed(BOB, DetectionFingerprintKind.ThreatIntel)),
        });

        await SecurityUserErasureRecords.unnameRecords({ projectId, names });

        const unnamed: string = [
          `Indicator \`${aliceToken}\` (email-addr, confidence 80) from the threat intel feed **${FEED_NAME}** matched 2 security events between 2026-11-24T09:00:00Z and 2026-11-24T09:15:00Z.`,
          `STIX indicator: \`${erasedIdOf(aliceToken)}\``,
          `Sample event: \`Sign-in from ${ADDRESS}\``,
        ].join("\n\n");

        const row: Record<string, unknown> = await rowOf(
          "SecurityDetection",
          detectionId,
        );

        expect(row["description"]).toBe(unnamed);
        expect(row["fingerprint"]).toBe(
          ofFeed(keyed(aliceToken, DetectionFingerprintKind.ThreatIntel)),
        );
        // The feed is still named; the indicator is not.
        expect(row["ruleName"]).toBe(FEED_NAME);
        expect((await rowOf("SecurityCase", caseId))["description"]).toBe(
          unnamed,
        );

        for (const kept of [row, await rowOf("SecurityCase", caseId)]) {
          const text: string = JSON.stringify(kept);

          expect(text).not.toContain(STIX_ID);
          expect(text).not.toContain("Phishing sender");
          expect(text.toLowerCase()).not.toContain(ALICE);
        }

        expect((await rowOf("SecurityDetection", bobId))["description"]).toBe(
          matchDescription(BOB, BOB_STIX_ID, "Phishing sender"),
        );
      });

      test("the events a detection kept: their stamp about the person says the token and the erased indicator id", async () => {
        const detectionId: ObjectID = await detection({
          source: SecurityDetectionSource.ThreatIntel,
          title: `${FEED_NAME} — ${ALICE}`,
          groupValue: ALICE,
          matchedEvents: {
            events: [
              {
                message: "Sign-in",
                principalUser: ALICE,
                attributes: {
                  "threat.indicator_value": ALICE,
                  "threat.indicator_id": STIX_ID,
                  "threat.feed": FEED_NAME,
                  "threat.indicator_type": "email-addr",
                },
              },
              {
                message: "Port scan",
                attributes: {
                  "threat.indicator_value": "198.51.100.66",
                  "threat.indicator_id": BOB_STIX_ID,
                },
              },
            ],
            outcomes: {},
          },
        });

        await SecurityUserErasureRecords.unnameRecords({ projectId, names });

        expect(
          (await rowOf("SecurityDetection", detectionId))["matchedEvents"],
        ).toEqual({
          events: [
            {
              message: "Sign-in",
              principalUser: aliceToken,
              attributes: {
                "threat.indicator_value": aliceToken,
                "threat.indicator_id": erasedIdOf(aliceToken),
                "threat.feed": FEED_NAME,
                "threat.indicator_type": "email-addr",
              },
            },
            {
              message: "Port scan",
              attributes: {
                "threat.indicator_value": "198.51.100.66",
                "threat.indicator_id": BOB_STIX_ID,
              },
            },
          ],
          outcomes: {},
        });
      });

      test("an alert and an incident the match opened: their description and the feed item that announced it say the erased indicator id, the rest as written", async () => {
        const fingerprint: string = ofFeed(
          legacy(ALICE, DetectionFingerprintKind.ThreatIntel),
        );
        const alertId: ObjectID = await alert(fingerprint, {
          title: `[Threat Intel] ${FEED_NAME} — ${ALICE}`,
          description: alertDescription(ALICE),
        });
        const alertItem: ObjectID = await feedItem(
          "AlertFeed",
          alertId,
          alertDescription(ALICE),
        );
        const incidentId: ObjectID = await insert("Incident", {
          projectId: projectId.toString(),
          title: `[Threat Intel] ${FEED_NAME} — ${ALICE}`,
          description: alertDescription(ALICE),
          seriesFingerprint: ofFeed(
            keyed(ALICE, DetectionFingerprintKind.ThreatIntel),
          ),
        });
        const incidentItem: ObjectID = await feedItem(
          "IncidentFeed",
          incidentId,
          alertDescription(ALICE),
        );
        // Somebody else's alert, of the same feed: as it was.
        const bobAlert: ObjectID = await alert(
          ofFeed(keyed(BOB, DetectionFingerprintKind.ThreatIntel)),
          {
            title: `[Threat Intel] ${FEED_NAME} — ${BOB}`,
            description: alertDescription(BOB, BOB_STIX_ID),
          },
        );
        const bobItem: ObjectID = await feedItem(
          "AlertFeed",
          bobAlert,
          alertDescription(BOB, BOB_STIX_ID),
        );

        const before: Record<string, unknown> = await rowOf("Alert", alertId);

        await SecurityUserErasureRecords.unnameRecords({ projectId, names });

        const erased: string = erasedIdOf(aliceToken);
        const after: Record<string, unknown> = await rowOf("Alert", alertId);

        expect(after["description"]).toBe(
          alertDescription(ALICE).replace(
            `STIX indicator: ${STIX_ID}`,
            `STIX indicator: ${erased}`,
          ),
        );
        expect(after["seriesFingerprint"]).toBe(
          ofFeed(keyed(aliceToken, DetectionFingerprintKind.ThreatIntel)),
        );
        // Nothing else about it changed: its title is left, as an erasure leaves alerts.
        expect({
          ...after,
          description: null,
          seriesFingerprint: null,
        }).toEqual({ ...before, description: null, seriesFingerprint: null });

        expect(
          (await rowOf("AlertFeed", alertItem))["feedInfoInMarkdown"],
        ).toContain(`STIX indicator: ${erased}`);
        expect(
          String((await rowOf("AlertFeed", alertItem))["feedInfoInMarkdown"]),
        ).not.toContain(STIX_ID);
        expect((await rowOf("Incident", incidentId))["description"]).toBe(
          alertDescription(ALICE).replace(
            `STIX indicator: ${STIX_ID}`,
            `STIX indicator: ${erased}`,
          ),
        );
        expect(
          String(
            (await rowOf("IncidentFeed", incidentItem))["feedInfoInMarkdown"],
          ),
        ).toContain(`STIX indicator: ${erased}`);

        expect((await rowOf("Alert", bobAlert))["description"]).toBe(
          alertDescription(BOB, BOB_STIX_ID),
        );
        expect(
          String((await rowOf("AlertFeed", bobItem))["feedInfoInMarkdown"]),
        ).toContain(`STIX indicator: ${BOB_STIX_ID}`);
      });

      test("what an earlier erasure un-named with the indicator left, a request filed again takes it out", async () => {
        const detectionId: ObjectID = await detection({
          source: SecurityDetectionSource.ThreatIntel,
          title: `${FEED_NAME} — ${aliceToken}`,
          description: matchDescription(aliceToken),
          groupValue: aliceToken,
          fingerprint: ofFeed(
            keyed(aliceToken, DetectionFingerprintKind.ThreatIntel),
          ),
        });
        const caseId: ObjectID = await insert("SecurityCase", {
          projectId: projectId.toString(),
          title: `${FEED_NAME} — ${aliceToken}`,
          description: matchDescription(aliceToken),
        });
        const alertId: ObjectID = await alert(
          ofFeed(keyed(aliceToken, DetectionFingerprintKind.ThreatIntel)),
          {
            title: `[Threat Intel] ${FEED_NAME} — ${ALICE}`,
            description: alertDescription(ALICE),
          },
        );

        await SecurityUserErasureRecords.unnameRecords({ projectId, names });

        for (const description of [
          (await rowOf("SecurityDetection", detectionId))["description"],
          (await rowOf("SecurityCase", caseId))["description"],
          (await rowOf("Alert", alertId))["description"],
        ]) {
          expect(String(description)).not.toContain(STIX_ID);
          expect(String(description)).toContain(erasedIdOf(aliceToken));
        }

        expect(
          String(
            (await rowOf("SecurityDetection", detectionId))["description"],
          ),
        ).not.toContain("Phishing sender");
      });

      test("running it again changes nothing", async () => {
        const caseId: ObjectID = await insert("SecurityCase", {
          projectId: projectId.toString(),
          title: `${FEED_NAME} — ${ALICE}`,
          description: matchDescription(ALICE),
        });

        await detection({
          securityCaseId: caseId.toString(),
          source: SecurityDetectionSource.ThreatIntel,
          title: `${FEED_NAME} — ${ALICE}`,
          description: matchDescription(ALICE),
          groupValue: ALICE,
          fingerprint: ofFeed(
            keyed(ALICE, DetectionFingerprintKind.ThreatIntel),
          ),
        });

        const alertId: ObjectID = await alert(
          ofFeed(keyed(ALICE, DetectionFingerprintKind.ThreatIntel)),
          { description: alertDescription(ALICE) },
        );

        await feedItem("AlertFeed", alertId, alertDescription(ALICE));
        await SecurityUserErasureRecords.unnameRecords({ projectId, names });

        const snapshot: () => Promise<string> = async (): Promise<string> => {
          const rows: Array<unknown> = [];

          for (const table of [
            "SecurityDetection",
            "SecurityCase",
            "Alert",
            "AlertFeed",
          ]) {
            rows.push(
              ...(await database.query(
                `SELECT * FROM "${schema}"."${table}" WHERE "projectId" = $1 ORDER BY "_id"`,
                [projectId.toString()],
              )),
            );
          }

          return JSON.stringify(rows);
        };

        const once: string = await snapshot();

        await SecurityUserErasureRecords.unnameRecords({ projectId, names });

        expect(await snapshot()).toBe(once);
      });
    });

    /*
     * #11231: a Sigma correlation that groups on several fields, with Write
     * Detection Findings and Open Security Cases off: nothing else keeps its
     * group value, but what it opened carries the value's fingerprint - its
     * alerts and incidents, and the firings its group's other entities'
     * risk counted.
     */
    describe("a correlation that opens no cases and writes no findings (#11231)", () => {
      const unnamedValue: () => string = (): string => {
        return `${aliceToken} / ${ADDRESS}`;
      };
      const TITLE: string = `[Detection] Sign-in burst — ${CORRELATION}`;

      test("its alert's and incident's fingerprints, read off their titles and proven by them, become the token's", async () => {
        const alertId: ObjectID = await alert(ofRule(legacy(CORRELATION)), {
          title: TITLE,
        });
        const incidentId: ObjectID = await insert("Incident", {
          projectId: projectId.toString(),
          title: TITLE,
          seriesFingerprint: ofRule(keyed(CORRELATION)),
        });

        const values: Array<ErasedName> =
          await SecurityUserErasureRecords.findCorrelationValues({
            projectId,
            names,
          });

        expect(values).toEqual([
          { named: CORRELATION, hashed: unnamedValue() },
        ]);

        await SecurityUserErasureRecords.unnameRecords({
          projectId,
          names: [...names, ...values],
        });

        expect(await seriesFingerprintOf("Alert", alertId)).toBe(
          ofRule(keyed(unnamedValue())),
        );
        expect(await seriesFingerprintOf("Incident", incidentId)).toBe(
          ofRule(keyed(unnamedValue())),
        );
      });

      test("an alert open under the correlation's value goes on taking its group's matches, about the token", async () => {
        const openAlert: ObjectID = await alert(ofRule(legacy(CORRELATION)), {
          title: TITLE,
        });

        jest
          .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
          .mockResolvedValue([OPEN_STATE_ID]);
        const create: ReturnType<typeof jest.spyOn> = jest
          .spyOn(AlertService, "create")
          .mockRejectedValue(new Error("nothing should open") as never);

        const fire: (groupValue: string) => Promise<Array<string>> = async (
          groupValue: string,
        ): Promise<Array<string>> => {
          const seen: Array<string> = [];

          await openDedupedAlerts({
            projectId,
            alertSeverityId: ObjectID.generate(),
            logLabel: "test",
            matches: [
              {
                ...DetectionRuleEvaluator.buildFingerprints(rule(), groupValue),
                title: "t",
                description: "d",
                rootCause: "r",
              },
            ],
            onOutcome: (outcome: DedupedRecordOutcome): void => {
              seen.push(outcome.recordId.toString());
            },
          });

          return seen;
        };

        expect(await fire(CORRELATION)).toEqual([openAlert.toString()]);

        const values: Array<ErasedName> =
          await SecurityUserErasureRecords.findCorrelationValues({
            projectId,
            names,
          });

        await SecurityUserErasureRecords.unnameRecords({
          projectId,
          names: [...names, ...values],
        });

        // The rule fires on the token now: the same alert takes it.
        expect(await fire(unnamedValue())).toEqual([openAlert.toString()]);
        expect(create).not.toHaveBeenCalled();
      });

      test("the firings its group's other entities' risk counted, read from the person's own risk before it is deleted", async () => {
        await insert("SecurityEntityRisk", {
          projectId: projectId.toString(),
          entityKey: ALICE,
          entityValue: ALICE,
          contributions: [
            {
              sourceKey: `rule:${RULE_ID.toString()}`,
              firingKeys: [firingKey(legacy(CORRELATION))],
            },
          ],
        });
        const addressRisk: ObjectID = await insert("SecurityEntityRisk", {
          projectId: projectId.toString(),
          entityKey: ADDRESS,
          entityValue: ADDRESS,
          contributions: [
            {
              sourceKey: `rule:${RULE_ID.toString()}`,
              firingKeys: [
                firingKey(legacy(CORRELATION)),
                firingKey(legacy(BOB), 2),
              ],
            },
          ],
        });

        const values: Array<ErasedName> =
          await SecurityUserErasureRecords.findCorrelationValues({
            projectId,
            names,
          });

        expect(values).toEqual([
          { named: CORRELATION, hashed: unnamedValue() },
        ]);

        await SecurityUserErasureRecords.unnameRecords({
          projectId,
          names: [...names, ...values],
        });

        // The person's risk row is gone; the address's counts the firing under the token's value.
        expect(
          await database.query(
            `SELECT "_id" FROM "${schema}"."SecurityEntityRisk" WHERE "entityKey" = $1`,
            [ALICE],
          ),
        ).toEqual([]);
        expect(
          (await rowOf("SecurityEntityRisk", addressRisk))["contributions"],
        ).toEqual([
          {
            sourceKey: `rule:${RULE_ID.toString()}`,
            firingKeys: [
              firingKey(keyed(unnamedValue())),
              firingKey(legacy(BOB), 2),
            ],
          },
        ]);
      });

      test("three values, a host first: the name and both other entities that counted the firing", async () => {
        const three: string = `web-01 / ${ALICE} / ${ADDRESS}`;

        await insert("SecurityEntityRisk", {
          projectId: projectId.toString(),
          entityKey: ALICE,
          entityValue: ALICE,
          contributions: [
            {
              sourceKey: `rule:${RULE_ID.toString()}`,
              firingKeys: [firingKey(keyed(three))],
            },
          ],
        });

        for (const entity of ["web-01", ADDRESS]) {
          await insert("SecurityEntityRisk", {
            projectId: projectId.toString(),
            entityKey: entity,
            entityValue: entity,
            contributions: [
              {
                sourceKey: `rule:${RULE_ID.toString()}`,
                firingKeys: [firingKey(keyed(three))],
              },
            ],
          });
        }

        expect(
          await SecurityUserErasureRecords.findCorrelationValues({
            projectId,
            names,
          }),
        ).toEqual([
          { named: three, hashed: `web-01 / ${aliceToken} / ${ADDRESS}` },
        ]);
      });

      test("a title its fingerprint does not prove names no value: its record is left", async () => {
        const alertId: ObjectID = await alert(ofRule(keyed("someone else")), {
          title: TITLE,
        });

        expect(
          await SecurityUserErasureRecords.findCorrelationValues({
            projectId,
            names,
          }),
        ).toEqual([]);

        await SecurityUserErasureRecords.unnameRecords({ projectId, names });

        expect(await seriesFingerprintOf("Alert", alertId)).toBe(
          ofRule(keyed("someone else")),
        );
      });

      test("nothing kept is a fingerprint of the correlation's value, keyed or not", async () => {
        await alert(ofRule(legacy(CORRELATION)), { title: TITLE });
        await insert("Incident", {
          projectId: projectId.toString(),
          title: TITLE,
          seriesFingerprint: ofRule(keyed(CORRELATION)),
        });
        await insert("SecurityEntityRisk", {
          projectId: projectId.toString(),
          entityKey: ALICE,
          entityValue: ALICE,
          contributions: [
            {
              sourceKey: `rule:${RULE_ID.toString()}`,
              firingKeys: [firingKey(legacy(CORRELATION))],
            },
          ],
        });
        await insert("SecurityEntityRisk", {
          projectId: projectId.toString(),
          entityKey: ADDRESS,
          entityValue: ADDRESS,
          contributions: [
            {
              sourceKey: `rule:${RULE_ID.toString()}`,
              firingKeys: [firingKey(legacy(CORRELATION))],
            },
          ],
        });

        const before: string = await everythingKept();

        expect(before).toContain(legacy(CORRELATION));

        const values: Array<ErasedName> =
          await SecurityUserErasureRecords.findCorrelationValues({
            projectId,
            names,
          });

        await SecurityUserErasureRecords.unnameRecords({
          projectId,
          names: [...names, ...values],
        });

        const after: string = await everythingKept();

        for (const fingerprint of [
          legacy(CORRELATION),
          keyed(CORRELATION),
          legacy(ALICE),
          keyed(ALICE),
        ]) {
          expect(after).not.toContain(fingerprint);
        }

        // And running it again changes nothing more.
        await SecurityUserErasureRecords.unnameRecords({
          projectId,
          names: [...names, ...values],
        });

        expect(await everythingKept()).toBe(after);
      });
    });
  });

  describe("a request", () => {
    async function file(user: string): Promise<SecurityUserErasureRequest> {
      const request: SecurityUserErasureRequest =
        new SecurityUserErasureRequest();

      request.projectId = projectId;
      request.userToErase = user;
      request.reference = "DSR-1042";

      return await SecurityUserErasureRequestService.create({
        data: request,
        props: { isRoot: true },
      });
    }

    test("keeps what was typed encrypted, never in clear, and its tokens as the vault refuses them", async () => {
      const created: SecurityUserErasureRequest =
        await file("Alice@Example.com");
      const stored: Record<string, unknown> = await rowOf(
        "SecurityUserErasureRequest",
        created.id!,
      );

      expect(stored["status"]).toBe(SecurityUserErasureRequestStatus.Pending);
      expect(typeof stored["userToErase"]).toBe("string");
      expect(String(stored["userToErase"]).toLowerCase()).not.toContain(
        "alice",
      );
      expect(stored["tokens"]).toEqual(
        expect.arrayContaining([
          aliceToken,
          ScrubHashToken.ofValue({ projectId, value: "Alice@Example.com" }),
        ]),
      );
      expect(JSON.stringify(stored).toLowerCase()).not.toContain("alice");

      expect(
        Array.from(
          await SecurityUserErasureRequestService.getErasedTokensOfProject(
            projectId,
          ),
        ).sort(),
      ).toEqual((stored["tokens"] as Array<string>).sort());
      expect(
        Array.from(
          await SecurityUserErasureRequestService.getErasedTokensOfProject(
            otherProjectId,
          ),
        ),
      ).toEqual([]);
    });

    test("the worker reads what was typed back, and wipes it once the request is over", async () => {
      const created: SecurityUserErasureRequest = await file(ALICE);
      const open: Array<SecurityUserErasureRequest> =
        await SecurityUserErasureRequestService.getOpenRequests({ limit: 10 });

      expect(open).toHaveLength(1);
      expect(open[0]!.userToErase).toBe(ALICE);

      await SecurityUserErasureRequestService.markInProgress({
        requestId: created.id!,
        counts: {
          vaultEntriesDeleted: 1,
          eventsUnnamed: 37,
          casesUnnamed: 2,
          proposalsWithdrawn: 1,
        },
      });
      await SecurityUserErasureRequestService.markCompleted({
        requestId: created.id!,
        counts: {
          vaultEntriesDeleted: 1,
          eventsUnnamed: 37,
          casesUnnamed: 2,
          proposalsWithdrawn: 1,
        },
      });

      const stored: Record<string, unknown> = await rowOf(
        "SecurityUserErasureRequest",
        created.id!,
      );

      expect(stored["status"]).toBe(SecurityUserErasureRequestStatus.Completed);
      expect(stored["userToErase"]).toBeNull();
      expect(stored["completedAt"]).toBeInstanceOf(Date);
      expect(stored["eventsUnnamed"]).toBe(37);
      expect(stored["tokens"]).toEqual([aliceToken]);
      expect(
        await SecurityUserErasureRequestService.getOpenRequests({ limit: 10 }),
      ).toEqual([]);
      // Over, but still refused.
      expect(
        (
          await SecurityUserErasureRequestService.getErasedTokensOfProject(
            projectId,
          )
        ).has(aliceToken),
      ).toBe(true);
    });

    test("one that fails for good is wiped too", async () => {
      const created: SecurityUserErasureRequest = await file(ALICE);

      await SecurityUserErasureRequestService.markInProgress({
        requestId: created.id!,
        counts: {
          vaultEntriesDeleted: 0,
          eventsUnnamed: 0,
          casesUnnamed: 0,
          proposalsWithdrawn: 0,
        },
        names,
      });
      await SecurityUserErasureRequestService.markFailed({
        requestId: created.id!,
        attempts: 5,
        failureReason: "ClickHouse is down",
      });

      const stored: Record<string, unknown> = await rowOf(
        "SecurityUserErasureRequest",
        created.id!,
      );

      expect(stored["status"]).toBe(SecurityUserErasureRequestStatus.Failed);
      expect(stored["userToErase"]).toBeNull();
      expect(stored["namesToErase"]).toBeNull();
      expect(stored["failureReason"]).toBe("ClickHouse is down");
    });

    test("who a run found the person named as is kept encrypted, never in clear, read back by the next run, and wiped once the request is over (#11044)", async () => {
      // Filed by the token: nothing typed, so the names are all the worker has.
      const created: SecurityUserErasureRequest = await file(aliceToken);

      await SecurityUserErasureRequestService.markInProgress({
        requestId: created.id!,
        counts: {
          vaultEntriesDeleted: 1,
          eventsUnnamed: 4,
          casesUnnamed: 1,
          proposalsWithdrawn: 0,
        },
        names,
      });

      const stored: Record<string, unknown> = await rowOf(
        "SecurityUserErasureRequest",
        created.id!,
      );

      expect(typeof stored["namesToErase"]).toBe("string");
      expect(JSON.stringify(stored).toLowerCase()).not.toContain("alice");
      expect(JSON.stringify(stored)).not.toContain(`auth0|${aliceToken}`);
      expect(stored["eventsUnnamed"]).toBe(4);

      // The next run reads them back as they were found.
      const open: Array<SecurityUserErasureRequest> =
        await SecurityUserErasureRequestService.getOpenRequests({ limit: 10 });

      expect(open).toHaveLength(1);
      expect(readErasureRequestNames(open[0]!)).toEqual(names);

      // Counts kept without names leave them as they were.
      await SecurityUserErasureRequestService.markInProgress({
        requestId: created.id!,
        counts: {
          vaultEntriesDeleted: 1,
          eventsUnnamed: 4,
          casesUnnamed: 1,
          proposalsWithdrawn: 0,
        },
      });

      expect(
        readErasureRequestNames(
          (
            await SecurityUserErasureRequestService.getOpenRequests({
              limit: 10,
            })
          )[0]!,
        ),
      ).toEqual(names);

      await SecurityUserErasureRequestService.markCompleted({
        requestId: created.id!,
        counts: {
          vaultEntriesDeleted: 1,
          eventsUnnamed: 4,
          casesUnnamed: 1,
          proposalsWithdrawn: 0,
        },
      });

      expect(
        (await rowOf("SecurityUserErasureRequest", created.id!))[
          "namesToErase"
        ],
      ).toBeNull();
    });

    test("where the worker got to is kept as it goes and read back by the next run as it was, holding nothing of the person (#11160)", async () => {
      const created: SecurityUserErasureRequest = await file(ALICE);
      const progress: SecurityUserErasureProgress = {
        toldAt: "2026-11-26T10:02:00.000Z",
        namedEvents: 4,
        cleanSince: "2026-11-26T10:03:00.000Z",
        unnamedFindings: 120,
        findings: {
          number: 2,
          startedAt: "2026-11-26T10:20:00.000Z",
          after: {
            time: "1764151200000000123",
            id: ObjectID.generate().toString(),
          },
          changed: 0,
          unnamed: 0,
          isFinal: true,
          endedAt: null,
        },
      };

      await SecurityUserErasureRequestService.markProgress({
        requestId: created.id!,
        progress,
        eventsUnnamed: 124,
      });

      const open: Array<SecurityUserErasureRequest> =
        await SecurityUserErasureRequestService.getOpenRequests({ limit: 10 });

      expect(readErasureRequestProgress(open[0]!)).toEqual(progress);

      const stored: Record<string, unknown> = await rowOf(
        "SecurityUserErasureRequest",
        created.id!,
      );

      expect(stored["eventsUnnamed"]).toBe(124);
      expect(stored["status"]).toBe(SecurityUserErasureRequestStatus.Pending);
      expect(JSON.stringify(stored["progress"]).toLowerCase()).not.toContain(
        "alice",
      );

      // A run told again keeps its progress beside its counts.
      await SecurityUserErasureRequestService.markInProgress({
        requestId: created.id!,
        counts: {
          vaultEntriesDeleted: 1,
          eventsUnnamed: 124,
          casesUnnamed: 0,
          proposalsWithdrawn: 0,
        },
        progress: { ...progress, toldAt: "2026-11-26T10:32:00.000Z" },
      });

      expect(
        readErasureRequestProgress(
          (
            await SecurityUserErasureRequestService.getOpenRequests({
              limit: 10,
            })
          )[0]!,
        ).toldAt,
      ).toBe("2026-11-26T10:32:00.000Z");
    });

    test("a pasted token keeps nothing typed at all", async () => {
      const created: SecurityUserErasureRequest = await file(aliceToken);
      const stored: Record<string, unknown> = await rowOf(
        "SecurityUserErasureRequest",
        created.id!,
      );

      expect(stored["userToErase"]).toBeNull();
      expect(stored["tokens"]).toEqual([aliceToken]);
    });

    test("claiming is atomic: of two workers, one starts it", async () => {
      const created: SecurityUserErasureRequest = await file(ALICE);
      const claim: () => Promise<boolean> = async (): Promise<boolean> => {
        return await SecurityUserErasureRequestService.compareAndSetColumnsByIdWithoutHooks(
          {
            id: created.id!,
            data: {
              status: SecurityUserErasureRequestStatus.InProgress,
            } as never,
            expectedData: {
              status: SecurityUserErasureRequestStatus.Pending,
            } as never,
          },
        );
      };

      expect(await Promise.all([claim(), claim()])).toEqual(
        expect.arrayContaining([true, false]),
      );
    });
  });
});
