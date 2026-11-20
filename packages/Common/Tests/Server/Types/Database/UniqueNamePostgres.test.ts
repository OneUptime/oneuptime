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
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../../Models/DatabaseModels/Label";
import StatusPageGroup from "../../../../Models/DatabaseModels/StatusPageGroup";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicySchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "../../../../Models/DatabaseModels/Team";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import LabelService from "../../../../Server/Services/LabelService";
import StatusPageGroupService from "../../../../Server/Services/StatusPageGroupService";
import OnCallDutyPolicyScheduleService from "../../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import TeamService from "../../../../Server/Services/TeamService";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import UpdateBy from "../../../../Server/Types/Database/UpdateBy";
import UniqueNameInProject from "../../../../Server/Utils/Database/UniqueNameInProject";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NameTakenException from "../../../../Types/Exception/NameTakenException";
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
 *     one, naming a policy in service first;
 *   - the teams that share a name, as their list marks them (#9746), are
 *     found as Postgres reads names, deleted ones and other projects' left
 *     out, and on-call policies and labels (#9856) only while in service;
 *   - a refused name carries its code beside its words (#9855), on a label's
 *     create as on a rename.
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
  IncidentSeverity,
  StatusPageGroup,
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

  /*
   * #9746: the records of a project that share a name, as their list marks
   * them - counted by their name in Postgres, as findWithSameName reads it,
   * among the project's records that are not deleted, then narrowed to the
   * ones the reader may read (TeamService.findBy, stubbed here as a reader
   * who may read every team but one).
   */
  test("the teams that share a name are found as names are compared, and only those", async () => {
    const tenantsA: string = await team("Tenants");
    const tenantsB: string = await team(` tenants${NO_BREAK_SPACE}`);
    const platformA: string = await team("Platform  Team");
    const platformHidden: string = await team(
      `platform${IDEOGRAPHIC_SPACE}team`,
    );
    await team("Solo");
    await team("Tenants", OTHER_PROJECT_ID);
    const deletedSolo: string = await team("SOLO");

    await database.query(
      `UPDATE ${tableOf(Team)} SET "deletedAt" = now() WHERE "_id" = $1`,
      [deletedSolo],
    );

    const asked: Array<string> = [];

    jest
      .spyOn(TeamService, "findBy")
      .mockImplementation(
        async (findBy: {
          query: Record<string, unknown>;
        }): Promise<Array<Team>> => {
          const ids: Array<unknown> = Object.values(
            (
              findBy.query["_id"] as {
                objectLiteralParameters: Record<string, unknown>;
              }
            ).objectLiteralParameters,
          )[0] as Array<unknown>;

          return ids
            .map((id: unknown): string => {
              return String(id).toLowerCase();
            })
            .filter((id: string): boolean => {
              asked.push(id);
              return id !== platformHidden;
            })
            .map((id: string): Team => {
              return new Team(new ObjectID(id));
            });
        },
      );

    const groups: Array<Array<string>> =
      await UniqueNameInProject.findRecordsSharingName({
        service: TeamService,
        projectId: PROJECT_ID,
        props: { userId: USER_ID, tenantId: PROJECT_ID },
      });

    const sorted: (ids: Array<string>) => Array<string> = (
      ids: Array<string>,
    ): Array<string> => {
      return [...ids].sort();
    };

    // Asked of the reader: every team whose name another of the project has.
    expect(sorted(asked)).toEqual(
      sorted([tenantsA, tenantsB, platformA, platformHidden]),
    );
    // "platform team" before "tenants"; Platform's twin is one the reader may not read.
    expect(groups.map(sorted)).toEqual([
      [platformA],
      sorted([tenantsA, tenantsB]),
    ]);
  });

  /*
   * #9856: labels are marked on Settings > Labels the same way, in service
   * only - an archived label is in no picker - as the route asks for them
   * (SharedNamesAPI: leaveOutArchived).
   */
  test("labels share a name only while in service, deleted ones and other projects' left out", async () => {
    const label: (
      name: string,
      options?: { isArchived?: boolean; projectId?: ObjectID },
    ) => Promise<string> = async (
      name: string,
      options?: { isArchived?: boolean; projectId?: ObjectID },
    ): Promise<string> => {
      return await insert(Label, {
        projectId: (options?.projectId || PROJECT_ID).toString(),
        name: name,
        color: "#ff0000",
        isArchived: Boolean(options?.isArchived),
      });
    };

    const production: string = await label("Production");
    const productionTwin: string = await label(` production${NO_BREAK_SPACE}`);
    await label("PRODUCTION", { isArchived: true });
    const staging: string = await label("Staging");
    await label("staging", { isArchived: true });
    await label("Production", { projectId: OTHER_PROJECT_ID });
    const deletedTwin: string = await label("Staging ");

    await database.query(
      `UPDATE ${tableOf(Label)} SET "deletedAt" = now() WHERE "_id" = $1`,
      [deletedTwin],
    );

    jest
      .spyOn(LabelService, "findBy")
      .mockImplementation(
        async (findBy: {
          query: Record<string, unknown>;
        }): Promise<Array<Label>> => {
          const ids: Array<unknown> = Object.values(
            (
              findBy.query["_id"] as {
                objectLiteralParameters: Record<string, unknown>;
              }
            ).objectLiteralParameters,
          )[0] as Array<unknown>;

          return ids.map((id: unknown): Label => {
            return new Label(new ObjectID(String(id)));
          });
        },
      );

    const groups: Array<Array<string>> =
      await UniqueNameInProject.findRecordsSharingName({
        service: LabelService,
        projectId: PROJECT_ID,
        props: { userId: USER_ID, tenantId: PROJECT_ID },
        leaveOutArchived: true,
      });

    // Production's twin in service is marked; Staging's only namesakes are archived or deleted.
    expect(
      groups.map((group: Array<string>): Array<string> => {
        return [...group].sort();
      }),
    ).toEqual([[production, productionTwin].sort()]);
    expect(groups.flat()).not.toContain(staging);
  });

  test("a refused label name carries its code, on a create and on a rename", async () => {
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

    const hooks: {
      onBeforeCreate: (createBy: CreateBy<Label>) => Promise<unknown>;
      onBeforeUpdateUniqueCheck: (updateBy: UpdateBy<Label>) => Promise<void>;
    } = LabelService as unknown as {
      onBeforeCreate: (createBy: CreateBy<Label>) => Promise<unknown>;
      onBeforeUpdateUniqueCheck: (updateBy: UpdateBy<Label>) => Promise<void>;
    };

    const model: Label = new Label();
    model.name = "PRODUCTION ";
    model.projectId = PROJECT_ID;

    const refusedCreate: unknown = await hooks
      .onBeforeCreate({
        data: model,
        props: { userId: USER_ID, tenantId: PROJECT_ID },
      } as unknown as CreateBy<Label>)
      .then(
        () => {
          return null;
        },
        (error: unknown) => {
          return error;
        },
      );

    expect(refusedCreate).toBeInstanceOf(NameTakenException);
    expect((refusedCreate as NameTakenException).details).toEqual({
      refusalCode: "name_taken",
    });

    jest
      .spyOn(LabelService, "findRowsAndHoldUpdateToThem")
      .mockImplementation(async (): Promise<Array<Label>> => {
        return await database.getRepository(Label).find({
          where: { _id: stagingId } as never,
          select: { _id: true, name: true, projectId: true } as never,
        });
      });

    const refusedRename: unknown = await hooks.onBeforeUpdateUniqueCheck
      .call(LabelService, {
        query: { _id: stagingId },
        data: { name: "production" },
        props: { userId: USER_ID, tenantId: PROJECT_ID },
        limit: 1,
        skip: 0,
      } as unknown as UpdateBy<Label>)
      .then(
        () => {
          return null;
        },
        (error: unknown) => {
          return error;
        },
      );

    expect(refusedRename).toBeInstanceOf(NameTakenException);
    expect((refusedRename as Error).message).toBe(
      "There is already a label called production in this project. Pick another name.",
    );
  });

  test("on-call policies share a name only while in service: an archived namesake is in no picker", async () => {
    const primary: string = await onCallPolicy("Primary");
    await onCallPolicy("primary", { isArchived: true });
    const weekends: string = await onCallPolicy("Weekends");
    const weekendsTwin: string = await onCallPolicy(" WEEKENDS");

    jest
      .spyOn(OnCallDutyPolicyService, "findBy")
      .mockImplementation(
        async (findBy: {
          query: Record<string, unknown>;
        }): Promise<Array<OnCallDutyPolicy>> => {
          const ids: Array<unknown> = Object.values(
            (
              findBy.query["_id"] as {
                objectLiteralParameters: Record<string, unknown>;
              }
            ).objectLiteralParameters,
          )[0] as Array<unknown>;

          return ids.map((id: unknown): OnCallDutyPolicy => {
            return new OnCallDutyPolicy(new ObjectID(String(id)));
          });
        },
      );

    const inService: Array<Array<string>> =
      await UniqueNameInProject.findRecordsSharingName({
        service: OnCallDutyPolicyService,
        projectId: PROJECT_ID,
        props: { userId: USER_ID, tenantId: PROJECT_ID },
        leaveOutArchived: true,
      });

    expect(
      inService.map((group: Array<string>): Array<string> => {
        return [...group].sort();
      }),
    ).toEqual([[weekends, weekendsTwin].sort()]);
    expect(inService.flat()).not.toContain(primary);

    // Counted with the archived ones, Primary has its namesake.
    const withArchived: Array<Array<string>> =
      await UniqueNameInProject.findRecordsSharingName({
        service: OnCallDutyPolicyService,
        projectId: PROJECT_ID,
        props: { userId: USER_ID, tenantId: PROJECT_ID },
      });

    expect(withArchived.flat()).toContain(primary);
  });

  /*
   * What a declarative client - Terraform, an API client that writes a
   * desired state - sees (#9742, docs/terraform/troubleshooting): a rename
   * onto a name another policy still holds is refused and writes nothing;
   * once that one gives the name up, the same rename goes through, so a
   * chain converges by the next apply (or in order, with depends_on). A swap
   * refuses both renames whatever the order, and goes through by way of a
   * name nobody holds.
   */
  test("a chain of renames converges once each name is given up, and a swap by way of a free name", async () => {
    const alpha: string = await onCallPolicy("Alpha");
    const beta: string = await onCallPolicy("Beta");

    const hook: (updateBy: UpdateBy<OnCallDutyPolicy>) => Promise<void> = (
      OnCallDutyPolicyService as unknown as {
        onBeforeUpdateUniqueCheck: (
          updateBy: UpdateBy<OnCallDutyPolicy>,
        ) => Promise<void>;
      }
    ).onBeforeUpdateUniqueCheck.bind(OnCallDutyPolicyService);

    // Checked as the service checks it, then written as the update would be.
    const rename: (id: string, name: string) => Promise<void> = async (
      id: string,
      name: string,
    ): Promise<void> => {
      jest
        .spyOn(OnCallDutyPolicyService, "findRowsAndHoldUpdateToThem")
        .mockImplementation(async (): Promise<Array<OnCallDutyPolicy>> => {
          return await database.getRepository(OnCallDutyPolicy).find({
            where: { _id: id } as never,
            select: { _id: true, name: true, projectId: true } as never,
          });
        });

      await hook({
        query: { _id: id },
        data: { name: name },
        props: { userId: USER_ID, tenantId: PROJECT_ID },
        limit: 1,
        skip: 0,
      } as unknown as UpdateBy<OnCallDutyPolicy>);

      await database.query(
        `UPDATE ${tableOf(OnCallDutyPolicy)} SET "name" = $1 WHERE "_id" = $2`,
        [name, id],
      );
    };

    const nameOf: (id: string) => Promise<string> = async (
      id: string,
    ): Promise<string> => {
      const rows: Array<{ name: string }> = await database.query(
        `SELECT "name" FROM ${tableOf(OnCallDutyPolicy)} WHERE "_id" = $1`,
        [id],
      );
      return rows[0]!.name;
    };

    // A chain, Alpha to Beta while Beta becomes Gamma: refused first...
    expect(await refusal(rename(alpha, "Beta"))).toBe(
      "There is already an on-call policy called Beta in this project. Pick another name.",
    );
    expect(await nameOf(alpha)).toBe("Alpha");

    // ...and through once Beta has given its name up.
    await rename(beta, "Gamma");
    await rename(alpha, "Beta");
    expect([await nameOf(alpha), await nameOf(beta)]).toEqual([
      "Beta",
      "Gamma",
    ]);

    // A swap, Beta and Gamma for each other: refused both ways round.
    expect(await refusal(rename(alpha, "Gamma"))).toContain(
      "called Gamma in this project",
    );
    expect(await refusal(rename(beta, "Beta"))).toContain(
      "called Beta in this project",
    );

    // By way of a name nobody holds, in three steps.
    await rename(alpha, "Beta (renaming)");
    await rename(beta, "Beta");
    await rename(alpha, "Gamma");
    expect([await nameOf(alpha), await nameOf(beta)]).toEqual([
      "Gamma",
      "Beta",
    ]);
  });

  /*
   * #10318: a kind whose model holds its name one of its kind
   * (@UniqueColumnBy) refuses a rename onto another record's name as a
   * create onto it is refused, compared by Postgres the way the create's
   * check compares it (LOWER of the stored name with the name written,
   * trimmed), with the archived code when only an archived record has it,
   * and only within the record's own scope: a status page group's page.
   */
  async function renameUnique<TBaseModel extends BaseModel>(data: {
    service: {
      findRowsAndHoldUpdateToThem: unknown;
    };
    model: { new (): TBaseModel };
    id: string;
    name: string;
  }): Promise<void> {
    jest
      .spyOn(data.service as never, "findRowsAndHoldUpdateToThem")
      .mockImplementation((async (): Promise<Array<TBaseModel>> => {
        return await database.getRepository(data.model).find({
          where: { _id: data.id } as never,
        });
      }) as never);

    await (
      data.service as unknown as {
        checkUniqueColumnByOnUpdate: (
          updateBy: UpdateBy<TBaseModel>,
        ) => Promise<void>;
      }
    ).checkUniqueColumnByOnUpdate({
      query: { _id: data.id },
      data: { name: data.name, description: "Wakes someone up." },
      props: { userId: USER_ID, tenantId: PROJECT_ID },
      limit: 1,
      skip: 0,
    } as unknown as UpdateBy<TBaseModel>);
  }

  test("a severity renamed onto another's name is refused, an archived one's with its own code; twins stay, and are renamed apart", async () => {
    const severity: (
      name: string,
      options?: { isArchived?: boolean; projectId?: ObjectID },
    ) => Promise<string> = async (
      name: string,
      options?: { isArchived?: boolean; projectId?: ObjectID },
    ): Promise<string> => {
      return await insert(IncidentSeverity, {
        projectId: (options?.projectId || PROJECT_ID).toString(),
        name: name,
        isArchived: Boolean(options?.isArchived),
      });
    };

    const criticalId: string = await severity("Critical");
    const criticalTwinId: string = await severity("CRITICAL");
    const minorId: string = await severity("Minor");
    await severity("Retired", { isArchived: true });
    await severity("Elsewhere", { projectId: OTHER_PROJECT_ID });

    const rename: (id: string, name: string) => Promise<void> = (
      id: string,
      name: string,
    ): Promise<void> => {
      return renameUnique({
        service: IncidentSeverityService,
        model: IncidentSeverity,
        id: id,
        name: name,
      });
    };

    const taken: unknown = await rename(minorId, " critical ").catch(
      (error: unknown): unknown => {
        return error;
      },
    );
    expect(taken).toBeInstanceOf(NameTakenException);
    expect((taken as NameTakenException).isTakenByArchived).toBe(false);
    expect((taken as Error).message).toBe(
      "Incident Severity with the same name already exists.",
    );

    const archived: unknown = await rename(minorId, "retired").catch(
      (error: unknown): unknown => {
        return error;
      },
    );
    expect(archived).toBeInstanceOf(NameTakenException);
    expect((archived as NameTakenException).isTakenByArchived).toBe(true);
    expect((archived as Error).message).toBe(
      "Incident Severity with the same name already exists, and it is archived. Unarchive it, or choose another name.",
    );

    // Another project's name is free; so is the record's own, in any case.
    await expect(rename(minorId, "Elsewhere")).resolves.toBeUndefined();
    await expect(rename(minorId, "MINOR")).resolves.toBeUndefined();

    // Twins from before: each written with its own name again, and renamed apart.
    await expect(rename(criticalTwinId, "Critical")).resolves.toBeUndefined();
    await expect(
      rename(criticalId, "Critical (Legacy)"),
    ).resolves.toBeUndefined();
  });

  test("a status page group's name is one group's on its page, not across pages", async () => {
    const PAGE_ID: string = ObjectID.generate().toString();
    const OTHER_PAGE_ID: string = ObjectID.generate().toString();

    const group: (
      name: string,
      statusPageId: string,
    ) => Promise<string> = async (
      name: string,
      statusPageId: string,
    ): Promise<string> => {
      return await insert(StatusPageGroup, {
        projectId: PROJECT_ID.toString(),
        statusPageId: statusPageId,
        name: name,
      });
    };

    const overviewId: string = await group("Overview", PAGE_ID);
    await group("Services", PAGE_ID);
    await group("Services", OTHER_PAGE_ID);

    const rename: (name: string) => Promise<void> = (
      name: string,
    ): Promise<void> => {
      return renameUnique({
        service: StatusPageGroupService,
        model: StatusPageGroup,
        id: overviewId,
        name: name,
      });
    };

    expect(await refusal(rename("SERVICES"))).toBe(
      "Status Page Group with the same name already exists.",
    );
    await expect(rename("Platform")).resolves.toBeUndefined();
  });
});
