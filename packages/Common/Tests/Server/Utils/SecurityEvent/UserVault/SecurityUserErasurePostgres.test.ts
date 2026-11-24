import Entities from "../../../../../Models/DatabaseModels/Index";
import SecurityUserErasureRequest from "../../../../../Models/DatabaseModels/SecurityUserErasureRequest";
import PostgresAppInstance from "../../../../../Server/Infrastructure/PostgresDatabase";
import DatabaseService from "../../../../../Server/Services/DatabaseService";
import SecurityCaseFeedService from "../../../../../Server/Services/SecurityCaseFeedService";
import SecurityUserErasureRequestService, {
  readErasureRequestNames,
} from "../../../../../Server/Services/SecurityUserErasureRequestService";
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
import SecurityPlaybookRunStatus from "../../../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { SecurityUserErasureRequestStatus } from "../../../../../Types/SecurityEvent/SecurityUserErasure";
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
 * Erasing one person from Security Events' user vault (#10908), against a
 * real Postgres: what the erasure changes in Postgres, and the requests
 * themselves, through the real SQL and the real services.
 *
 *   - detections: the "<rule> — <name>" title, the group value, the
 *     entities and the kept events get the token - found by the name in a
 *     jsonb column's text, which only a real driver shows;
 *   - cases: the title, the entities and the grouping key, written with
 *     SQL of their own (so the audit log never keeps the name);
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
      ).toEqual([caseId.toString()]);

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
