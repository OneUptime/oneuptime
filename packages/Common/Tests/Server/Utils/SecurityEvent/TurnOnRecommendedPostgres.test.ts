import Entities from "../../../../Models/DatabaseModels/Index";
import DetectionRule from "../../../../Models/DatabaseModels/DetectionRule";
import SecurityPlaybook from "../../../../Models/DatabaseModels/SecurityPlaybook";
import CommonAPI from "../../../../Server/API/CommonAPI";
import SecurityCaseAPI from "../../../../Server/API/SecurityCaseAPI";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import { WidenDetectionRuleName1806400000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1806400000000-WidenDetectionRuleName";
import DetectionRuleService from "../../../../Server/Services/DetectionRuleService";
import SecurityLogSourceService from "../../../../Server/Services/SecurityLogSourceService";
import SecurityTelemetrySourceService from "../../../../Server/Services/SecurityTelemetrySourceService";
import SecurityCasePriorityService from "../../../../Server/Services/SecurityCasePriorityService";
import SecurityCaseStatusService from "../../../../Server/Services/SecurityCaseStatusService";
import SecurityPlaybookService from "../../../../Server/Services/SecurityPlaybookService";
import SecurityCaseValues, {
  ProjectSecurityCaseValues,
} from "../../../../Server/Utils/SecurityCase/SecurityCaseValues";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../../Server/Utils/Express";
import Response from "../../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
  getRecommendedDetectionRules,
} from "../../../../Types/SecurityEvent/DetectionRuleLibrary";
import {
  SECURITY_TELEMETRY_SOURCE_KINDS,
  SecurityTelemetrySourceKind,
} from "../../../../Types/SecurityEvent/SecurityTelemetrySource";
import EnterpriseEdition from "../../../../Server/Enterprise/EnterpriseEdition";
import {
  TurnOnRecommendedAction,
  TurnOnRecommendedPart,
  TurnOnRecommendedReason,
} from "../../../../Types/SecurityEvent/TurnOnRecommended";
import { SECURITY_PLAYBOOK_TEMPLATE_DEFINITIONS } from "../../../../Types/SecurityPlaybook/SecurityPlaybookTemplates";
import UserType from "../../../../Types/UserType";
import {
  buildDetectionRuleFromLibrary,
  buildSecurityPlaybookFromTemplate,
} from "../../../../Utils/SecurityEvent/SecurityTemplateRecords";
import { DataSource, QueryRunner } from "typeorm";

/*
 * The kinds of your OneUptime data the click turns on: every one, but the
 * audit log only where OneUptime Enterprise writes it.
 */
const TELEMETRY_SOURCES_TURNED_ON: number =
  SECURITY_TELEMETRY_SOURCE_KINDS.filter(
    (kind: SecurityTelemetrySourceKind): boolean => {
      return (
        kind !== SecurityTelemetrySourceKind.AuditLog ||
        EnterpriseEdition.isLoaded()
      );
    },
  ).length;

/*
 * TURN ON RECOMMENDED, ON A MIGRATED POSTGRES, THROUGH ITS ROUTE.
 *
 * Opt in with RUN_POSTGRES_TURN_ON_RECOMMENDED_TESTS=true against a database
 * every registered migration has been applied to:
 *
 *   RUN_POSTGRES_TURN_ON_RECOMMENDED_TESTS=true \
 *   TURN_ON_RECOMMENDED_TEST_DATABASE_HOST=127.0.0.1 \
 *   TURN_ON_RECOMMENDED_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Utils/SecurityEvent/TurnOnRecommendedPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml ("Test Turn on
 * recommended on migrated Postgres"), after that job has migrated an empty
 * database. The Common test job's Postgres is not migrated, so it is
 * skipped there.
 *
 * POST /security-case/setup/turn-on-recommended runs as a Security Admin,
 * with the production SecurityCaseAPI, SecuritySetup and services, on
 * structure-only copies of the migrated DetectionRule, SecurityPlaybook,
 * SecurityLogSource, SecurityTelemetrySource, SecurityCasePriority and
 * SecurityCaseStatus tables in a
 * schema of their own (CREATE TABLE ... LIKE ... INCLUDING ALL: their
 * columns, widths, defaults and indexes) - the project's case priorities and
 * statuses, which a template's steps name, written there the first time
 * they are read, as for a project that had none. Only the
 * realtime and workflow triggers are stubbed. Nothing is written outside the
 * schema, and the schema is dropped afterwards.
 *
 *   - from nothing: your logs, every recommended rule (the 53-character
 *     sequence included, whole) and Enrich New Cases, as the caller;
 *   - run twice: the second writes nothing;
 *   - one write failing part way (the database refuses it): every other
 *     part is written, the answer names the one with why, and the next run
 *     writes only it;
 *   - with rules added by hand: a renamed rule is turned back on, never
 *     copied; one of the same name is left as it is;
 *   - a name column still 50 wide, as before WidenDetectionRuleName: the
 *     long title alone is refused, the rest is written - and the migration
 *     widens that column in place, keeping its rows;
 *   - every Rule Library entry and every playbook template, created as the
 *     Rule Library's Add All and the Playbooks page create them.
 */

const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_TURN_ON_RECOMMENDED_TESTS"] === "true"
    ? describe
    : describe.skip;

type Handler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

const recordedRoutes: Array<{ uri: string; handlers: Array<Handler> }> = [];

jest.mock("../../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return {
        post: (uri: string, ...handlers: Array<Handler>): void => {
          recordedRoutes.push({ uri, handlers });
        },
        get: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
      };
    },
  };
});

jest.mock("../../../../Server/Utils/Response", () => {
  return { sendJsonObjectResponse: jest.fn() };
});

const TABLES: Array<string> = [
  "DetectionRule",
  "SecurityPlaybook",
  "SecurityLogSource",
  "SecurityTelemetrySource",
  "SecurityCasePriority",
  "SecurityCaseStatus",
];

const SEQUENCE_TITLE: string =
  "Failed sign-ins, then a success from the same address";
const SPRAYING_TITLE: string = "Password spraying";

interface RuleRow {
  name: string;
  isEnabled: boolean;
  sigmaRuleYaml: string;
  createdByUserId: string | null;
}

interface PlaybookRow {
  name: string;
  isEnabled: boolean;
  trigger: string;
  steps: Array<unknown>;
}

interface LogSourceRow {
  isEnabled: boolean;
  createdByUserId: string | null;
}

describePostgres("Turn on recommended against a migrated Postgres", () => {
  const schema: string = `turn_on_recommended_${ObjectID.generate()
    .toString()
    .split("-")
    .join("")}`;
  const projectId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();
  const recommended: Array<DetectionRuleLibraryEntry> =
    getRecommendedDetectionRules();

  let database: DataSource;
  let props: DatabaseCommonInteractionProps;

  function securityAdminProps(): DatabaseCommonInteractionProps {
    const tenantPermission: UserTenantAccessPermission = {
      projectId: projectId,
      _type: "UserTenantAccessPermission",
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.SecurityAdmin,
          labelIds: [],
          isBlockPermission: false,
        },
      ],
    };

    return {
      tenantId: projectId,
      userId: userId,
      userType: UserType.User,
      userTenantAccessPermission: {
        [projectId.toString()]: tenantPermission,
      },
    };
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["TURN_ON_RECOMMENDED_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["TURN_ON_RECOMMENDED_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["TURN_ON_RECOMMENDED_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
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

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    for (const service of [
      DetectionRuleService,
      SecurityPlaybookService,
      SecurityLogSourceService,
      SecurityTelemetrySourceService,
      SecurityCasePriorityService,
      SecurityCaseStatusService,
    ]) {
      jest
        .spyOn(service as typeof DetectionRuleService, "onTriggerRealtime")
        .mockResolvedValue(undefined);
      jest
        .spyOn(service as typeof DetectionRuleService, "onTriggerWorkflow")
        .mockResolvedValue(undefined);
    }

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockImplementation(async () => {
        return props;
      });

    new SecurityCaseAPI();
  });

  beforeEach(async () => {
    props = securityAdminProps();
    (Response.sendJsonObjectResponse as jest.Mock).mockClear();
    await database.query(
      TABLES.map((table: string): string => {
        return `DELETE FROM "${schema}"."${table}"`;
      }).join("; "),
    );
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  // The route as the Overview's card calls it; the answer, or what it failed with.
  async function turnOn(body: JSONObject = {}): Promise<JSONObject> {
    const found: { uri: string; handlers: Array<Handler> } | undefined =
      recordedRoutes.find((item: { uri: string }) => {
        return item.uri === "/security-case/setup/turn-on-recommended";
      });
    expect(found).toBeDefined();

    const sent: jest.Mock = Response.sendJsonObjectResponse as jest.Mock;
    sent.mockClear();
    let failure: unknown = null;

    await found!.handlers[found!.handlers.length - 1]!(
      { params: {}, body } as unknown as ExpressRequest,
      {} as ExpressResponse,
      ((error: unknown): void => {
        failure = error;
      }) as NextFunction,
    );

    expect(failure).toBeNull();
    expect(sent).toHaveBeenCalledTimes(1);

    // As the browser reads it.
    return JSON.parse(JSON.stringify(sent.mock.calls[0]![2])) as JSONObject;
  }

  async function rules(): Promise<Array<RuleRow>> {
    return database.query(
      `SELECT "name", "isEnabled", "sigmaRuleYaml", "createdByUserId" FROM "${schema}"."DetectionRule" ORDER BY "createdAt", "name"`,
    );
  }

  async function playbooks(): Promise<Array<PlaybookRow>> {
    return database.query(
      `SELECT "name", "isEnabled", "trigger", "steps" FROM "${schema}"."SecurityPlaybook" ORDER BY "createdAt"`,
    );
  }

  async function logSources(): Promise<Array<LogSourceRow>> {
    return database.query(
      `SELECT "isEnabled", "createdByUserId" FROM "${schema}"."SecurityLogSource"`,
    );
  }

  async function telemetrySources(): Promise<
    Array<{ kind: string; isEnabled: boolean; createdByUserId: string }>
  > {
    return database.query(
      `SELECT "kind", "isEnabled", "createdByUserId" FROM "${schema}"."SecurityTelemetrySource" ORDER BY "kind"`,
    );
  }

  function namesOf(rows: Array<RuleRow>): Array<string> {
    return rows
      .map((row: RuleRow): string => {
        return row.name;
      })
      .sort();
  }

  function titlesOf(entries: Array<DetectionRuleLibraryEntry>): Array<string> {
    return entries
      .map((entry: DetectionRuleLibraryEntry): string => {
        return entry.title;
      })
      .sort();
  }

  // A row written straight into the copy, as a person's earlier edit left it.
  async function insertRule(data: {
    name: string;
    sigmaRuleYaml: string;
    isEnabled: boolean;
  }): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."DetectionRule" ("_id", "projectId", "name", "sigmaRuleYaml", "isEnabled", "version")
       VALUES ($1, $2, $3, $4, $5, 1)`,
      [
        ObjectID.generate().toString(),
        projectId.toString(),
        data.name,
        data.sigmaRuleYaml,
        data.isEnabled,
      ],
    );
  }

  test("from nothing: your logs, every recommended rule and Enrich New Cases are written as the caller, and the answer says so", async () => {
    const answer: JSONObject = await turnOn();

    expect(answer).toEqual({
      rulesAdded: recommended.length,
      rulesTurnedOn: 0,
      logsTurnedOn: true,
      telemetrySourcesTurnedOn: TELEMETRY_SOURCES_TURNED_ON,
      playbookAdded: true,
      playbookTurnedOn: false,
      problems: [],
    });

    const written: Array<RuleRow> = await rules();
    expect(namesOf(written)).toEqual(titlesOf(recommended));

    // The title that broke it, stored whole.
    const sequence: RuleRow | undefined = written.find((row: RuleRow) => {
      return row.name === SEQUENCE_TITLE;
    });
    expect(sequence?.name.length).toBe(53);

    for (const row of written) {
      expect(row.isEnabled).toBe(true);
      expect(row.createdByUserId).toBe(userId.toString());
    }

    expect(await logSources()).toEqual([
      { isEnabled: true, createdByUserId: userId.toString() },
    ]);

    // The rest of your OneUptime data, each kind once, as the caller.
    const sources: Array<{
      kind: string;
      isEnabled: boolean;
      createdByUserId: string;
    }> = await telemetrySources();
    expect(sources).toHaveLength(TELEMETRY_SOURCES_TURNED_ON);
    for (const source of sources) {
      expect(source.isEnabled).toBe(true);
      expect(source.createdByUserId).toBe(userId.toString());
    }

    const playbookRows: Array<PlaybookRow> = await playbooks();
    expect(playbookRows).toHaveLength(1);
    expect(playbookRows[0]).toMatchObject({
      name: "Enrich New Cases",
      isEnabled: true,
      trigger: "Case Opened",
    });
    expect(playbookRows[0]!.steps.length).toBeGreaterThan(0);
  });

  test("run twice: the second run writes nothing, and answers that nothing was left", async () => {
    await turnOn();
    const before: number = (await rules()).length;

    const answer: JSONObject = await turnOn();

    expect(answer).toEqual({
      rulesAdded: 0,
      rulesTurnedOn: 0,
      logsTurnedOn: false,
      telemetrySourcesTurnedOn: 0,
      playbookAdded: false,
      playbookTurnedOn: false,
      problems: [],
    });
    expect((await rules()).length).toBe(before);
    expect(await playbooks()).toHaveLength(1);
    expect(await logSources()).toHaveLength(1);
    expect(await telemetrySources()).toHaveLength(TELEMETRY_SOURCES_TURNED_ON);
  });

  test("a write the database refuses part way: the rest is written, the answer names it with why, and the next run writes only it", async () => {
    // The database refuses one rule's insert, half way through the rules.
    await database.query(
      `CREATE FUNCTION "${schema}".refuse_spraying() RETURNS trigger AS $$
       BEGIN
         IF NEW."name" = '${SPRAYING_TITLE}' THEN
           RAISE EXCEPTION 'refused by the test';
         END IF;
         RETURN NEW;
       END;
       $$ LANGUAGE plpgsql`,
    );
    await database.query(
      `CREATE TRIGGER refuse_spraying BEFORE INSERT ON "${schema}"."DetectionRule"
       FOR EACH ROW EXECUTE FUNCTION "${schema}".refuse_spraying()`,
    );

    try {
      const answer: JSONObject = await turnOn();

      expect(answer["rulesAdded"]).toBe(recommended.length - 1);
      expect(answer["logsTurnedOn"]).toBe(true);
      expect(answer["playbookAdded"]).toBe(true);
      expect(answer["problems"]).toEqual([
        {
          part: TurnOnRecommendedPart.Rule,
          action: TurnOnRecommendedAction.Add,
          name: SPRAYING_TITLE,
          reason: TurnOnRecommendedReason.Failed,
          detail: "",
        },
      ]);
      // The database's own words stay in the log.
      expect(JSON.stringify(answer)).not.toContain("refused by the test");

      // What is left: every part but that rule.
      expect(namesOf(await rules())).toEqual(
        titlesOf(
          recommended.filter((entry: DetectionRuleLibraryEntry) => {
            return entry.title !== SPRAYING_TITLE;
          }),
        ),
      );
      expect(await playbooks()).toHaveLength(1);
      expect(await logSources()).toHaveLength(1);
    } finally {
      await database.query(
        `DROP TRIGGER refuse_spraying ON "${schema}"."DetectionRule"`,
      );
      await database.query(`DROP FUNCTION "${schema}".refuse_spraying()`);
    }

    // Try again: only the one that was left.
    const again: JSONObject = await turnOn();

    expect(again).toEqual({
      rulesAdded: 1,
      rulesTurnedOn: 0,
      logsTurnedOn: false,
      telemetrySourcesTurnedOn: 0,
      playbookAdded: false,
      playbookTurnedOn: false,
      problems: [],
    });
    expect(namesOf(await rules())).toEqual(titlesOf(recommended));
  });

  test("with rules added by hand: a renamed one is turned back on, one of the same name is left as it is, the rest are added", async () => {
    const bruteForce: DetectionRuleLibraryEntry = recommended[0]!;
    // Renamed by the team and turned off: its YAML still carries the library id.
    await insertRule({
      name: "Our brute force rule",
      sigmaRuleYaml: bruteForce.sigmaRuleYaml,
      isEnabled: false,
    });
    // Written by hand, under the library's name.
    await insertRule({
      name: SPRAYING_TITLE,
      sigmaRuleYaml:
        "title: Password spraying\ndetection:\n  selection:\n    className: Authentication\n  condition: selection\n",
      isEnabled: true,
    });

    const answer: JSONObject = await turnOn({ logs: false, playbook: false });

    expect(answer).toEqual({
      rulesAdded: recommended.length - 2,
      rulesTurnedOn: 1,
      logsTurnedOn: false,
      telemetrySourcesTurnedOn: 0,
      playbookAdded: false,
      playbookTurnedOn: false,
      problems: [],
    });

    const written: Array<RuleRow> = await rules();
    // One rule per recommended entry: nothing copied.
    expect(written).toHaveLength(recommended.length);
    expect(
      written.find((row: RuleRow) => {
        return row.name === "Our brute force rule";
      })?.isEnabled,
    ).toBe(true);
    expect(
      written.some((row: RuleRow) => {
        return row.name === bruteForce.title;
      }),
    ).toBe(false);
    expect(
      written.filter((row: RuleRow) => {
        return row.name === SPRAYING_TITLE;
      }),
    ).toHaveLength(1);
  });

  test("a name column still 50 wide refuses the long title alone, and the migration widens it in place, keeping its rules", async () => {
    // As an installation's table was before WidenDetectionRuleName.
    await database.query(
      `ALTER TABLE "${schema}"."DetectionRule" ALTER COLUMN "name" TYPE character varying(50)`,
    );

    try {
      const answer: JSONObject = await turnOn();

      // The long title is refused by the database; nothing else is held up.
      expect(answer["rulesAdded"]).toBe(recommended.length - 1);
      expect(answer["playbookAdded"]).toBe(true);
      expect(answer["logsTurnedOn"]).toBe(true);
      // Postgres's "value too long" is the database's to log, not the reader's.
      expect(answer["problems"]).toEqual([
        {
          part: TurnOnRecommendedPart.Rule,
          action: TurnOnRecommendedAction.Add,
          name: SEQUENCE_TITLE,
          reason: TurnOnRecommendedReason.Failed,
          detail: "",
        },
      ]);
      expect(JSON.stringify(answer)).not.toContain("value too long");

      // The migration, on this copy (the search path reaches it first).
      const queryRunner: QueryRunner = database.createQueryRunner();
      try {
        await new WidenDetectionRuleName1806400000000().up(queryRunner);
      } finally {
        await queryRunner.release();
      }

      const widths: Array<{ width: string }> = await database.query(
        `SELECT format_type(a.atttypid, a.atttypmod) AS "width"
           FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND c.relname = 'DetectionRule' AND a.attname = 'name'`,
        [schema],
      );
      expect(widths[0]?.width).toBe("character varying(100)");
      // Every rule kept.
      expect((await rules()).length).toBe(recommended.length - 1);

      // Try again: the long title fits now.
      const again: JSONObject = await turnOn();
      expect(again["rulesAdded"]).toBe(1);
      expect(again["problems"]).toEqual([]);
      expect(namesOf(await rules())).toEqual(titlesOf(recommended));
    } finally {
      await database.query(
        `ALTER TABLE "${schema}"."DetectionRule" ALTER COLUMN "name" TYPE character varying(100)`,
      );
    }
  });

  test("every Rule Library entry and every playbook template is created as it is, as the Rule Library and the Playbooks page create them", async () => {
    for (const entry of DETECTION_RULE_LIBRARY) {
      await DetectionRuleService.create({
        data: buildDetectionRuleFromLibrary({ projectId, entry }),
        props,
      });
    }

    // The project's case priorities and statuses, as the Playbooks page reads them.
    const values: ProjectSecurityCaseValues =
      await SecurityCaseValues.getForProject(projectId);

    for (const template of SECURITY_PLAYBOOK_TEMPLATE_DEFINITIONS) {
      await SecurityPlaybookService.create({
        data: buildSecurityPlaybookFromTemplate({
          projectId,
          template,
          priorities: values.priorities,
          statuses: values.statuses,
        }),
        props,
      });
    }

    expect(namesOf(await rules())).toEqual(
      titlesOf([...DETECTION_RULE_LIBRARY]),
    );
    expect(
      (await playbooks())
        .map((row: PlaybookRow): string => {
          return row.name;
        })
        .sort(),
    ).toEqual(
      SECURITY_PLAYBOOK_TEMPLATE_DEFINITIONS.map(
        (template: { title: string }): string => {
          return template.title;
        },
      ).sort(),
    );

    // And the one click, after all that, has nothing left to add.
    const answer: JSONObject = await turnOn({ logs: false });
    expect(answer["rulesAdded"]).toBe(0);
    expect(answer["playbookAdded"]).toBe(false);
    expect(answer["problems"]).toEqual([]);
  });

  test("a Security Member may not turn your logs on: refused before anything is written", async () => {
    props = {
      ...securityAdminProps(),
      userTenantAccessPermission: {
        [projectId.toString()]: {
          projectId: projectId,
          _type: "UserTenantAccessPermission",
          permissions: [
            {
              _type: "UserPermission",
              permission: Permission.SecurityMember,
              labelIds: [],
              isBlockPermission: false,
            },
          ],
        },
      },
    };

    const found: { uri: string; handlers: Array<Handler> } | undefined =
      recordedRoutes.find((item: { uri: string }) => {
        return item.uri === "/security-case/setup/turn-on-recommended";
      });
    let failure: unknown = null;

    await found!.handlers[found!.handlers.length - 1]!(
      { params: {}, body: {} } as unknown as ExpressRequest,
      {} as ExpressResponse,
      ((error: unknown): void => {
        failure = error;
      }) as NextFunction,
    );

    expect(failure).toBeInstanceOf(Error);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    expect(await rules()).toEqual([]);
    expect(await logSources()).toEqual([]);
    expect(await playbooks()).toEqual([]);
  });

  test("the models the copies were made from are the ones the services write", () => {
    expect(new DetectionRule().tableName).toBe("DetectionRule");
    expect(new SecurityPlaybook().tableName).toBe("SecurityPlaybook");
  });
});
