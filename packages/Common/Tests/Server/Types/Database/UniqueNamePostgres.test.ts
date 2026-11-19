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
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Entities from "../../../../Models/DatabaseModels/Index";
import Label from "../../../../Models/DatabaseModels/Label";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicySchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "../../../../Models/DatabaseModels/Team";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import LabelService from "../../../../Server/Services/LabelService";
import OnCallDutyPolicyScheduleService from "../../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import TeamService from "../../../../Server/Services/TeamService";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import UpdateBy from "../../../../Server/Types/Database/UpdateBy";
import BadDataException from "../../../../Types/Exception/BadDataException";
import {
  NAME_WHITE_SPACE_RUN_PATTERN,
  getNameKey,
  getNameKeySql,
} from "../../../../Types/Database/UniqueName";
import ObjectID from "../../../../Types/ObjectID";
import { DataSource, EntityMetadata } from "typeorm";
import { ColumnMetadata } from "typeorm/metadata/ColumnMetadata";

// A byte order mark, which draws as nothing.
const BYTE_ORDER_MARK: string = String.fromCharCode(0xfeff);
// A figure space.
const FIGURE_SPACE: string = String.fromCharCode(0x2007);
// An ideographic space, as a Japanese keyboard types one.
const IDEOGRAPHIC_SPACE: string = String.fromCharCode(0x3000);
// A narrow no-break space.
const NARROW_NO_BREAK_SPACE: string = String.fromCharCode(0x202f);
// A no-break space, as a document pastes one.
const NO_BREAK_SPACE: string = String.fromCharCode(0xa0);

/*
 * A NAME AS IT READS, ON POSTGRES (#9674).
 *
 * QueryHelper.findWithSameName compares a name column with a name, both
 * read in Postgres the way getNameKey reads them: every run of white space
 * one space, none around it, in lower case. Here, on real rows:
 *
 *   - Postgres reads each name exactly as getNameKey does, every kind of
 *     space JavaScript's \s matches included (a non-breaking space pasted
 *     from a document, a tab, an ideographic space), whatever the
 *     database's locale says a space is;
 *   - a team or label is found by any way its name is written, and nothing
 *     else is: not a name that only starts the same, not another project's;
 *   - TeamService refuses a new team and a rename onto a name another team
 *     of the project holds, however either was saved, and lets through a
 *     team written with its own name again, though another shares it;
 *   - LabelService refuses a rename onto another label's name;
 *   - OnCallDutyPolicyService and OnCallDutyPolicyScheduleService refuse a
 *     new one, and a rename, onto a name another of the project has
 *     (#9742), and a policy's refusal says where to unarchive an archived
 *     one, naming a policy in service first.
 *
 * Needs only a bare Postgres: each model's table is made from its own column
 * metadata in a schema of its own, dropped afterwards. CI's Common test job
 * sets the flag for the one test-setup.sh starts. Locally, against a
 * throwaway container:
 *
 *   docker run -d --name unique-name-pg -e POSTGRES_PASSWORD=password \
 *     -e POSTGRES_DB=oneuptimedb -p 127.0.0.1:55433:5432 postgres:15
 *   RUN_POSTGRES_UNIQUE_NAME_TESTS=true \
 *   UNIQUE_NAME_TEST_DATABASE_HOST=127.0.0.1 \
 *   UNIQUE_NAME_TEST_DATABASE_PORT=55433 \
 *   DATABASE_PASSWORD=password \
 *     npx jest Tests/Server/Types/Database/UniqueNamePostgres.test.ts
 *   docker rm -f unique-name-pg
 */

const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_UNIQUE_NAME_TESTS"] === "true"
    ? describe
    : describe.skip;

const SCHEMA: string = `unique_name_${process.pid}_${Date.now()}`;

const MODELS: Array<{ new (): BaseModel }> = [
  Team,
  Label,
  OnCallDutyPolicy,
  OnCallDutyPolicySchedule,
];

const PROJECT_ID: ObjectID = ObjectID.generate();
const OTHER_PROJECT_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();

// Every spelling of a name the comparison reads as one name, and some that are not.
const SPELLINGS: ReadonlyArray<string> = [
  "Tenants",
  "tenants",
  " TENANTS ",
  "Platform Team",
  "Platform  Team",
  "Platform\tTeam",
  `Platform${NO_BREAK_SPACE}Team`,
  `Platform${FIGURE_SPACE}Team`,
  `Platform${NARROW_NO_BREAK_SPACE}Team`,
  `Platform${IDEOGRAPHIC_SPACE}Team`,
  `${BYTE_ORDER_MARK}Platform Team\n`,
  "Équipe Plateforme",
  "ÉQUIPE   plateforme",
  "Команда",
  "КОМАНДА",
  "x-y",
  "x_y",
  "100% team",
  "Platform",
];

describePostgres("a name as it reads, on Postgres", () => {
  let database: DataSource;

  const tableOf: (model: { new (): BaseModel }) => string = (model: {
    new (): BaseModel;
  }): string => {
    return `"${SCHEMA}"."${database.getMetadata(model).tableName}"`;
  };

  async function insert(
    model: { new (): BaseModel },
    row: Record<string, unknown>,
  ): Promise<string> {
    const id: string = ObjectID.generate().toString();
    const values: Record<string, unknown> = { _id: id, ...row };
    const columns: Array<string> = Object.keys(values);

    await database.query(
      `INSERT INTO ${tableOf(model)} (${columns
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
        return value instanceof ObjectID ? value.toString() : value;
      }),
    );

    return id;
  }

  async function team(name: string, projectId?: ObjectID): Promise<string> {
    return await insert(Team, {
      projectId: (projectId || PROJECT_ID).toString(),
      name: name,
      slug: name,
      isTeamEditable: true,
      isTeamDeleteable: true,
      isPermissionsEditable: true,
      shouldHaveAtLeastOneMember: false,
    });
  }

  async function refusal(write: Promise<unknown>): Promise<string> {
    try {
      await write;
    } catch (error) {
      expect(error).toBeInstanceOf(BadDataException);
      return (error as Error).message;
    }

    throw new Error("Expected the write to be refused.");
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["UNIQUE_NAME_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["UNIQUE_NAME_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["UNIQUE_NAME_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema: SCHEMA,
      synchronize: false,
      extra: {
        options: `-c search_path=${SCHEMA}`,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${SCHEMA}"`);

    // Each model's own columns, without the foreign keys: the rows stand alone.
    for (const model of MODELS) {
      const metadata: EntityMetadata = database.getMetadata(model);
      const columns: Map<string, string> = new Map<string, string>();

      for (const column of metadata.columns as Array<ColumnMetadata>) {
        if (columns.has(column.databaseName)) {
          continue;
        }

        let definition: string = database.driver.normalizeType(column);

        if (column.isPrimary) {
          definition += " PRIMARY KEY";
        } else if (column.isCreateDate || column.isUpdateDate) {
          definition += " NOT NULL DEFAULT now()";
        } else if (column.isVersion) {
          definition += " NOT NULL DEFAULT 1";
        }

        columns.set(column.databaseName, definition);
      }

      await database.query(
        `CREATE TABLE ${tableOf(model)} (${Array.from(columns.entries())
          .map(([name, definition]: [string, string]): string => {
            return `"${name}" ${definition}`;
          })
          .join(", ")})`,
      );
    }
  }, 120_000);

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    for (const model of MODELS) {
      await database.query(`TRUNCATE ${tableOf(model)}`);
    }

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("Postgres reads each name exactly as getNameKey does", async () => {
    for (const spelling of SPELLINGS) {
      const rows: Array<{ key: string }> = await database.query(
        `SELECT ${getNameKeySql({
          textSql: "CAST($1 AS TEXT)",
          patternSql: "CAST($2 AS TEXT)",
        })} AS key`,
        [spelling, NAME_WHITE_SPACE_RUN_PATTERN],
      );

      expect({ spelling, key: rows[0]!.key }).toEqual({
        spelling,
        key: getNameKey(spelling),
      });
    }
  });

  test("a team is found by every way its name is written, and by nothing else", async () => {
    const tenantsId: string = await team("Tenants ");
    const platformId: string = await team(`Platform${NO_BREAK_SPACE} Team`);
    await team("Tenants", OTHER_PROJECT_ID);
    await team("Tenants Team");

    const found: (name: string) => Promise<Array<string>> = async (
      name: string,
    ): Promise<Array<string>> => {
      const rows: Array<Team> = await database.getRepository(Team).find({
        where: {
          projectId: PROJECT_ID,
          name: QueryHelper.findWithSameName(name),
        } as never,
        select: { _id: true } as never,
      });

      return rows.map((row: Team): string => {
        return row._id!.toString();
      });
    };

    for (const name of ["Tenants", "tenants", "  TENANTS", "Tenants\t"]) {
      expect({ name, found: await found(name) }).toEqual({
        name,
        found: [tenantsId],
      });
    }

    for (const name of [
      "Platform Team",
      "platform  team",
      `Platform${IDEOGRAPHIC_SPACE}Team`,
      `${BYTE_ORDER_MARK}PLATFORM TEAM`,
    ]) {
      expect({ name, found: await found(name) }).toEqual({
        name,
        found: [platformId],
      });
    }

    for (const name of ["Tenant", "PlatformTeam", "Platform", "%", "_"]) {
      expect({ name, found: await found(name) }).toEqual({ name, found: [] });
    }
  });

  test("a new team named as another team of the project is refused, however either is written", async () => {
    await team("  Tenants");

    const createBy: (name: string) => CreateBy<Team> = (
      name: string,
    ): CreateBy<Team> => {
      const model: Team = new Team();
      model.name = name;
      model.projectId = PROJECT_ID;

      return {
        data: model,
        props: { userId: USER_ID, tenantId: PROJECT_ID },
      } as unknown as CreateBy<Team>;
    };

    const hook: (createBy: CreateBy<Team>) => Promise<void> = (
      TeamService as unknown as {
        onBeforeCreateUniqueCheck: (createBy: CreateBy<Team>) => Promise<void>;
      }
    ).onBeforeCreateUniqueCheck.bind(TeamService);

    expect(await refusal(hook(createBy("TENANTS ")))).toBe(
      "There is already a team called TENANTS in this project. Pick another name.",
    );
    await expect(hook(createBy("Tenants Two"))).resolves.toBeUndefined();
  });

  test("a rename onto another team's name is refused; a team written with its own name again is not, though another shares it", async () => {
    const tenantsId: string = await team("Tenants");
    const twinId: string = await team("Tenants");
    const platformId: string = await team("Platform");

    const hook: (updateBy: UpdateBy<Team>) => Promise<void> = (
      TeamService as unknown as {
        onBeforeUpdateUniqueCheck: (updateBy: UpdateBy<Team>) => Promise<void>;
      }
    ).onBeforeUpdateUniqueCheck.bind(TeamService);

    const rename: (id: string, name: string) => Promise<void> = async (
      id: string,
      name: string,
    ): Promise<void> => {
      jest
        .spyOn(TeamService, "findRowsAndHoldUpdateToThem")
        .mockImplementation(async (): Promise<Array<Team>> => {
          return await database.getRepository(Team).find({
            where: { _id: id } as never,
            select: { _id: true, name: true, projectId: true } as never,
          });
        });

      await hook({
        query: { _id: id },
        data: { name: name, description: "For all tenants." },
        props: { userId: USER_ID, tenantId: PROJECT_ID },
        limit: 1,
        skip: 0,
      } as unknown as UpdateBy<Team>);
    };

    expect(await refusal(rename(platformId, " tenants"))).toBe(
      "There is already a team called tenants in this project. Pick another name.",
    );
    await expect(rename(tenantsId, "Tenants")).resolves.toBeUndefined();
    await expect(rename(twinId, "TENANTS")).resolves.toBeUndefined();
    await expect(rename(twinId, "Tenants (Shared)")).resolves.toBeUndefined();
  });

  test("a label renamed onto another label's name is refused", async () => {
    await insert(Label, {
      projectId: PROJECT_ID.toString(),
      name: "Production",
      color: "#ff0000",
      isArchived: false,
    });
    const stagingId: string = await insert(Label, {
      projectId: PROJECT_ID.toString(),
      name: "Staging",
      color: "#00ff00",
      isArchived: false,
    });

    jest
      .spyOn(LabelService, "findRowsAndHoldUpdateToThem")
      .mockImplementation(async (): Promise<Array<Label>> => {
        return await database.getRepository(Label).find({
          where: { _id: stagingId } as never,
          select: { _id: true, name: true, projectId: true } as never,
        });
      });

    const hook: (updateBy: UpdateBy<Label>) => Promise<void> = (
      LabelService as unknown as {
        onBeforeUpdateUniqueCheck: (updateBy: UpdateBy<Label>) => Promise<void>;
      }
    ).onBeforeUpdateUniqueCheck.bind(LabelService);

    expect(
      await refusal(
        hook({
          query: { _id: stagingId },
          data: { name: `production${NO_BREAK_SPACE}` },
          props: { userId: USER_ID, tenantId: PROJECT_ID },
          limit: 1,
          skip: 0,
        } as unknown as UpdateBy<Label>),
      ),
    ).toBe(
      "There is already a label called production in this project. Pick another name.",
    );
  });

  /*
   * #9742: an on-call policy's and an on-call schedule's name, held to the
   * same rule through the same helper, on real rows: an archived policy
   * keeps its name, and a policy in service is the one named when both have
   * it - Postgres sorts false before true.
   */
  async function onCallPolicy(
    name: string,
    options?: { isArchived?: boolean; projectId?: ObjectID },
  ): Promise<string> {
    return await insert(OnCallDutyPolicy, {
      projectId: (options?.projectId || PROJECT_ID).toString(),
      name: name,
      slug: name,
      isArchived: Boolean(options?.isArchived),
    });
  }

  async function onCallSchedule(name: string): Promise<string> {
    return await insert(OnCallDutyPolicySchedule, {
      projectId: PROJECT_ID.toString(),
      name: name,
      slug: name,
    });
  }

  test("a new on-call policy named as another, in service or archived, is refused with the words for each", async () => {
    await onCallPolicy("Primary ", { isArchived: true });
    await onCallPolicy(`Weekend${NO_BREAK_SPACE}Cover`, { isArchived: true });
    await onCallPolicy("weekend cover");
    await onCallPolicy("Elsewhere", { projectId: OTHER_PROJECT_ID });

    const hook: (createBy: CreateBy<OnCallDutyPolicy>) => Promise<void> = (
      OnCallDutyPolicyService as unknown as {
        onBeforeCreateUniqueCheck: (
          createBy: CreateBy<OnCallDutyPolicy>,
        ) => Promise<void>;
      }
    ).onBeforeCreateUniqueCheck.bind(OnCallDutyPolicyService);

    const createBy: (name: string) => CreateBy<OnCallDutyPolicy> = (
      name: string,
    ): CreateBy<OnCallDutyPolicy> => {
      const model: OnCallDutyPolicy = new OnCallDutyPolicy();
      model.name = name;
      model.projectId = PROJECT_ID;

      return {
        data: model,
        props: { userId: USER_ID, tenantId: PROJECT_ID },
      } as unknown as CreateBy<OnCallDutyPolicy>;
    };

    expect(await refusal(hook(createBy("PRIMARY")))).toBe(
      "There is already an archived on-call policy called PRIMARY in this project. Unarchive it from On-Call > Advanced > Archived Policies, or pick another name.",
    );
    // Both have the name: the one in service is named.
    expect(await refusal(hook(createBy("Weekend  Cover")))).toBe(
      "There is already an on-call policy called Weekend Cover in this project. Pick another name.",
    );
    await expect(hook(createBy("Elsewhere"))).resolves.toBeUndefined();
    await expect(hook(createBy("Primary Two"))).resolves.toBeUndefined();
  });

  test("an on-call policy or schedule renamed onto another's name is refused; one written with its own name again is not", async () => {
    const primaryId: string = await onCallPolicy("Primary");
    const secondaryId: string = await onCallPolicy("Secondary");
    const scheduleId: string = await onCallSchedule("Weekdays");
    const twinId: string = await onCallSchedule("weekdays");
    const weekendsId: string = await onCallSchedule("Weekends");

    async function rename<TBaseModel extends BaseModel>(data: {
      service: {
        findRowsAndHoldUpdateToThem: unknown;
      };
      model: { new (): TBaseModel };
      id: string;
      name: string;
    }): Promise<void> {
      jest
        .spyOn(
          data.service as unknown as {
            findRowsAndHoldUpdateToThem: () => Promise<Array<TBaseModel>>;
          },
          "findRowsAndHoldUpdateToThem",
        )
        .mockImplementation(async (): Promise<Array<TBaseModel>> => {
          return await database.getRepository(data.model).find({
            where: { _id: data.id } as never,
            select: { _id: true, name: true, projectId: true } as never,
          });
        });

      await (
        data.service as unknown as {
          onBeforeUpdateUniqueCheck: (
            updateBy: UpdateBy<TBaseModel>,
          ) => Promise<void>;
        }
      ).onBeforeUpdateUniqueCheck.call(data.service, {
        query: { _id: data.id },
        data: { name: data.name, description: "Weekday cover." },
        props: { userId: USER_ID, tenantId: PROJECT_ID },
        limit: 1,
        skip: 0,
      } as unknown as UpdateBy<TBaseModel>);
    }

    const policyService: { findRowsAndHoldUpdateToThem: unknown } =
      OnCallDutyPolicyService as unknown as {
        findRowsAndHoldUpdateToThem: unknown;
      };
    const scheduleService: { findRowsAndHoldUpdateToThem: unknown } =
      OnCallDutyPolicyScheduleService as unknown as {
        findRowsAndHoldUpdateToThem: unknown;
      };

    expect(
      await refusal(
        rename({
          service: policyService,
          model: OnCallDutyPolicy,
          id: secondaryId,
          name: " primary",
        }),
      ),
    ).toBe(
      "There is already an on-call policy called primary in this project. Pick another name.",
    );
    await expect(
      rename({
        service: policyService,
        model: OnCallDutyPolicy,
        id: primaryId,
        name: "PRIMARY",
      }),
    ).resolves.toBeUndefined();

    expect(
      await refusal(
        rename({
          service: scheduleService,
          model: OnCallDutyPolicySchedule,
          id: weekendsId,
          name: `Weekdays${IDEOGRAPHIC_SPACE}`,
        }),
      ),
    ).toBe(
      "There is already an on-call schedule called Weekdays in this project. Pick another name.",
    );
    // Twins from before: each can still be edited, and renamed apart.
    await expect(
      rename({
        service: scheduleService,
        model: OnCallDutyPolicySchedule,
        id: twinId,
        name: "Weekdays",
      }),
    ).resolves.toBeUndefined();
    await expect(
      rename({
        service: scheduleService,
        model: OnCallDutyPolicySchedule,
        id: scheduleId,
        name: "Weekdays (EU)",
      }),
    ).resolves.toBeUndefined();
  });
});
