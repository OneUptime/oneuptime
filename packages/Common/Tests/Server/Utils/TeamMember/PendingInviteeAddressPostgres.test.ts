import Entities from "../../../../Models/DatabaseModels/Index";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import PagedFind, {
  FindBuilderAdjuster,
} from "../../../../Server/Infrastructure/Postgres/PagedFind";
import { BACKFILL_TEAM_MEMBER_INVITEE_EMAIL_STATEMENT } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809186970000-BackfillTeamMemberInviteeEmail";
import Query from "../../../../Server/Types/Database/Query";
import QueryUtil from "../../../../Server/Types/Database/QueryUtil";
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../../../../Server/Utils/TeamMember/PendingInviteeProfiles";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import EqualTo from "../../../../Types/BaseDatabase/EqualTo";
import Includes from "../../../../Types/BaseDatabase/Includes";
import Search from "../../../../Types/BaseDatabase/Search";
import StartsWith from "../../../../Types/BaseDatabase/StartsWith";
import ObjectID from "../../../../Types/ObjectID";
import UserType from "../../../../Types/UserType";
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
import { DataSource, In } from "typeorm";

/*
 * SOMEONE ONLY INVITED IS SHOWN BY THE ADDRESS THEY WERE INVITED AT, ON
 * POSTGRES (#10175).
 *
 * A membership read through its person reads the account's address, which
 * an invitee may change before they accept. Every project that had invited
 * them showed it - on its Users list, team pages, pickers and audit logs -
 * though they had not joined it. Now a pending person is shown, searched,
 * filtered and ordered by the address their invitation kept
 * (TeamMember.inviteeEmail), and a member as before. On migrated tables,
 * through PendingInviteeProfiles as DatabaseService reads with it - the rows
 * a read returns (withholdFromRows), the filter it is narrowed by
 * (narrowRelationFilters, then QueryUtil.serializeQuery, then TypeORM), and
 * the order it is given (PagedFind's adjuster):
 *
 *   - Grace was invited at grace.old@ and has since moved her account to
 *     aaa.grace.new@: the project sees grace.old@ in her row, finds her by
 *     it, never by aaa.grace.new@, and orders her by it - not first, where
 *     her account's address would put her;
 *   - once she accepts, the project sees aaa.grace.new@, as it sees any
 *     member's own address;
 *   - Bob, a member, moved his account to bob.new@: the project sees it, as
 *     before;
 *   - Hal, invited before addresses were kept, is shown by his account's,
 *     as before - and the backfill keeps that for him;
 *   - root and a master admin read accounts as they are.
 *
 * Opt in with RUN_POSTGRES_PENDING_INVITEE_ADDRESS_TESTS=true against a
 * database the registered migrations have run on: the tables are copied
 * from public into a schema of the suite's own, every row is synthetic,
 * and the schema is dropped afterwards.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_PENDING_INVITEE_ADDRESS_TESTS"] === "true"
    ? describe
    : describe.skip;

type Row = Record<string, unknown>;

const NOW: number = Date.UTC(2026, 10, 20, 9, 0, 0);

const TABLES: ReadonlyArray<string> = ["Project", "Team", "User", "TeamMember"];

describePostgres(
  "someone only invited, by the address invited, on Postgres",
  () => {
    const schema: string = `invitee_address_${ObjectID.generate().toString().split("-").join("")}`;
    let database: DataSource;
    let sequence: number = 0;

    const projectId: string = ObjectID.generate().toString();
    // Another project, which invited Grace at another address, later.
    const otherProjectId: string = ObjectID.generate().toString();

    const people: Record<string, string> = {};
    const teamIds: Record<string, string> = {};
    const graceMemberships: Array<string> = [];

    function nextId(): string {
      sequence++;
      return `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;
    }

    function at(minutes: number): Date {
      return new Date(NOW + minutes * 60 * 1000);
    }

    async function requiredFillers(table: string): Promise<Row> {
      const columns: Array<{
        column_name: string;
        data_type: string;
        udt_name: string;
        character_maximum_length: number | null;
      }> = await database.query(
        `SELECT column_name, data_type, udt_name, character_maximum_length
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       AND is_nullable = 'NO' AND column_default IS NULL`,
        [schema, table],
      );
      const fillers: Row = {};

      for (const column of columns) {
        if (column.data_type === "uuid") {
          fillers[column.column_name] = ObjectID.generate().toString();
        } else if (
          column.data_type === "character varying" ||
          column.data_type === "text"
        ) {
          sequence++;
          fillers[column.column_name] = `v${sequence}`.slice(
            0,
            column.character_maximum_length || 100,
          );
        } else if (
          [
            "integer",
            "bigint",
            "numeric",
            "smallint",
            "double precision",
          ].includes(column.data_type)
        ) {
          fillers[column.column_name] = 0;
        } else if (column.data_type === "boolean") {
          fillers[column.column_name] = false;
        } else if (column.data_type.startsWith("timestamp")) {
          fillers[column.column_name] = at(0);
        } else if (
          column.data_type === "jsonb" ||
          column.data_type === "json"
        ) {
          fillers[column.column_name] = {};
        } else if (column.data_type === "USER-DEFINED") {
          const values: Array<{ value: string }> = await database.query(
            `SELECT unnest(enum_range(NULL::"${schema}"."${column.udt_name}"))::text AS value`,
          );
          fillers[column.column_name] = values[0]?.value;
        }
      }

      return fillers;
    }

    const fillersByTable: Map<string, Row> = new Map();

    async function insert(table: string, row: Row): Promise<string> {
      if (!fillersByTable.has(table)) {
        fillersByTable.set(table, await requiredFillers(table));
      }

      const id: string = (row["_id"] as string) || nextId();
      const values: Row = {
        ...fillersByTable.get(table),
        _id: id,
        version: 1,
        ...row,
      };
      const columns: Array<string> = Object.keys(values);

      await database.query(
        `INSERT INTO "${schema}"."${table}" (${columns
          .map((column: string) => {
            return `"${column}"`;
          })
          .join(", ")}) VALUES (${columns
          .map((_column: string, index: number) => {
            return `$${index + 1}`;
          })
          .join(", ")})`,
        columns.map((column: string) => {
          const value: unknown = values[column];
          return value && typeof value === "object" && !(value instanceof Date)
            ? JSON.stringify(value)
            : value;
        }),
      );

      return id;
    }

    async function person(
      key: string,
      name: string,
      email: string,
    ): Promise<void> {
      people[key] = await insert("User", {
        name: name,
        email: email,
        slug: `${key}-${sequence}`,
      });
    }

    async function membership(data: {
      person: string;
      project: string;
      team: string;
      accepted: boolean;
      inviteeEmail?: string | null;
      minutes?: number;
    }): Promise<string> {
      return await insert("TeamMember", {
        projectId: data.project,
        teamId: teamIds[data.team],
        userId: people[data.person],
        hasAcceptedInvitation: data.accepted,
        inviteeEmail: data.inviteeEmail ?? null,
        createdAt: at(data.minutes || 0),
        updatedAt: at(data.minutes || 0),
      });
    }

    async function setAddress(key: string, email: string): Promise<void> {
      await database.query(
        `UPDATE "${schema}"."User" SET "email" = $1 WHERE "_id" = $2`,
        [email, people[key]],
      );
    }

    function personReading(): DatabaseCommonInteractionProps {
      return {
        userId: new ObjectID(people["reader"]!),
        userType: UserType.User,
        tenantId: new ObjectID(projectId),
      };
    }

    function apiKeyReading(): DatabaseCommonInteractionProps {
      return { userType: UserType.API, tenantId: new ObjectID(projectId) };
    }

    /*
     * The project's memberships, as a read of the Users list returns them to
     * `props`: filtered by `userFilter` through the relation (narrowed as
     * ReadPermission narrows it, then serialized as DatabaseService
     * serializes it), ordered by `order`, each person as the reader may see
     * them (withholdFromRows).
     */
    async function readUsersList(data: {
      props: DatabaseCommonInteractionProps;
      userFilter?: Record<string, unknown> | undefined;
      order?: "ASC" | "DESC" | undefined;
    }): Promise<Array<{ person: string; email: string }>> {
      // Written first, then narrowed: as BasePermission, then ReadPermission.
      const serialized: Query<TeamMember> = QueryUtil.serializeQuery(
        TeamMember,
        {
          projectId: new ObjectID(projectId),
          ...(data.userFilter ? { user: data.userFilter } : {}),
        } as unknown as Query<TeamMember>,
      );

      const where: Query<TeamMember> =
        PendingInviteeProfiles.narrowRelationFilters({
          modelType: TeamMember,
          query: serialized,
          props: data.props,
        });

      const adjust: FindBuilderAdjuster | null =
        PendingInviteeProfiles.getOrderAdjuster(data.props);

      const rows: Array<TeamMember> = await PagedFind.find(
        database.getRepository(TeamMember),
        {
          where: where as never,
          relations: { user: true },
          select: {
            _id: true,
            userId: true,
            user: { _id: true, name: true, email: true },
          },
          order: data.order
            ? ({
                user: { email: data.order },
                _id: "ASC",
              } as never)
            : ({ _id: "ASC" } as never),
          skip: 0,
          take: 100,
        },
        adjust,
      );

      await PendingInviteeProfiles.withholdFromRows({
        modelType: TeamMember,
        rows: rows,
        select: { user: { _id: true, name: true, email: true } },
        props: data.props,
      });

      const seen: Set<string> = new Set<string>();
      const shown: Array<{ person: string; email: string }> = [];

      for (const row of rows) {
        const key: string | undefined = Object.keys(people).find(
          (candidate: string): boolean => {
            return people[candidate] === row.userId?.toString();
          },
        );

        if (!key || seen.has(key)) {
          continue;
        }

        seen.add(key);
        shown.push({ person: key, email: row.user?.email?.toString() || "" });
      }

      return shown;
    }

    function addressOf(
      shown: Array<{ person: string; email: string }>,
      key: string,
    ): string | undefined {
      return shown.find((entry: { person: string }): boolean => {
        return entry.person === key;
      })?.email;
    }

    function peopleIn(shown: Array<{ person: string }>): Array<string> {
      return shown
        .map((entry: { person: string }): string => {
          return entry.person;
        })
        .sort();
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["PENDING_INVITEE_ADDRESS_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["PENDING_INVITEE_ADDRESS_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["PENDING_INVITEE_ADDRESS_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        // The rule's own statements name "TeamMember" as any query does.
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      for (const id of [projectId, otherProjectId]) {
        await insert("Project", {
          _id: id,
          name: `Project ${id.slice(0, 4)}`,
          slug: id,
        });
      }

      teamIds["owners"] = await insert("Team", {
        projectId: projectId,
        name: "Owners",
        slug: `owners-${sequence}`,
      });
      teamIds["responders"] = await insert("Team", {
        projectId: projectId,
        name: "Responders",
        slug: `responders-${sequence}`,
      });
      teamIds["elsewhere"] = await insert("Team", {
        projectId: otherProjectId,
        name: "Elsewhere",
        slug: `elsewhere-${sequence}`,
      });

      await person("reader", "Mona Reader", "reader@acme.test");
      await person("grace", "Grace Own", "grace.old@acme.test");
      await person("bob", "Bob Member", "bob.old@acme.test");
      await person("hal", "Hal Own", "hal@acme.test");

      await membership({
        person: "reader",
        project: projectId,
        team: "owners",
        accepted: true,
      });
      await membership({
        person: "bob",
        project: projectId,
        team: "responders",
        accepted: true,
      });

      // Grace: invited here at grace.old@, on two teams.
      graceMemberships.push(
        await membership({
          person: "grace",
          project: projectId,
          team: "responders",
          accepted: false,
          inviteeEmail: "grace.old@acme.test",
          minutes: 1,
        }),
      );
      graceMemberships.push(
        await membership({
          person: "grace",
          project: projectId,
          team: "owners",
          accepted: false,
          inviteeEmail: null,
          minutes: 2,
        }),
      );

      // Hal: invited before addresses were kept.
      await membership({
        person: "hal",
        project: projectId,
        team: "responders",
        accepted: false,
        inviteeEmail: null,
        minutes: 3,
      });

      // Later, another project of the reader's invited Grace at another address.
      await membership({
        person: "reader",
        project: otherProjectId,
        team: "elsewhere",
        accepted: true,
      });
      await membership({
        person: "grace",
        project: otherProjectId,
        team: "elsewhere",
        accepted: false,
        inviteeEmail: "grace.elsewhere@acme.test",
        minutes: 10,
      });

      // Then Grace and Bob moved their accounts.
      await setAddress("grace", "aaa.grace.new@acme.test");
      await setAddress("bob", "bob.new@acme.test");
    }, 120000);

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(() => {
      // The rule's own read of who is pending, against this suite's tables.
      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database as never);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    describe("what a read shows", () => {
      test("Grace, only invited, shows the address she was invited at; Bob, a member, his own new one", async () => {
        const shown: Array<{ person: string; email: string }> =
          await readUsersList({ props: personReading() });

        expect(addressOf(shown, "grace")).toBe("grace.old@acme.test");
        expect(addressOf(shown, "bob")).toBe("bob.new@acme.test");
        expect(addressOf(shown, "reader")).toBe("reader@acme.test");
        // Invited before addresses were kept: his account's, as before.
        expect(addressOf(shown, "hal")).toBe("hal@acme.test");
      });

      test("an API key reads the project as a person in it does", async () => {
        const shown: Array<{ person: string; email: string }> =
          await readUsersList({ props: apiKeyReading() });

        expect(addressOf(shown, "grace")).toBe("grace.old@acme.test");
        expect(addressOf(shown, "bob")).toBe("bob.new@acme.test");
      });

      test("the request's project's invitation wins over a newer one elsewhere", async () => {
        const elsewhere: DatabaseCommonInteractionProps = {
          ...personReading(),
          tenantId: new ObjectID(otherProjectId),
        };
        const shown: Array<{ person: string; email: string }> =
          await readUsersList({ props: personReading() });

        expect(addressOf(shown, "grace")).toBe("grace.old@acme.test");

        // Read in the other project, the address it invited.
        const rows: Map<string, WithheldProfile> =
          await PendingInviteeProfiles.readWithheldProfiles({
            userIds: [people["grace"]!],
            props: elsewhere,
          });

        expect(rows.get(people["grace"]!)?.inviteeEmail).toBe(
          "grace.elsewhere@acme.test",
        );
      });

      test("root and a master admin read the account as it is", async () => {
        for (const props of [
          { isRoot: true },
          { isMasterAdmin: true, userId: new ObjectID(people["reader"]!) },
        ] as Array<DatabaseCommonInteractionProps>) {
          const shown: Array<{ person: string; email: string }> =
            await readUsersList({ props: props });

          expect(addressOf(shown, "grace")).toBe("aaa.grace.new@acme.test");
        }
      });
    });

    describe("what a search finds", () => {
      test.each([
        [
          "a search",
          (text: string): unknown => {
            return new Search(text);
          },
        ],
        [
          "an exact address",
          (text: string): unknown => {
            return text;
          },
        ],
        [
          "equal to",
          (text: string): unknown => {
            return new EqualTo(text);
          },
        ],
        [
          "starts with",
          (text: string): unknown => {
            return new StartsWith(text);
          },
        ],
      ])(
        "%s finds Grace by the address she was invited at, never by her account's new one",
        async (_label: string, filterOf: (text: string) => unknown) => {
          const exact: boolean = _label !== "a search";

          const byNew: Array<{ person: string }> = await readUsersList({
            props: personReading(),
            userFilter: {
              email: filterOf(exact ? "aaa.grace.new@acme.test" : "grace.new"),
            },
          });
          const byOld: Array<{ person: string }> = await readUsersList({
            props: personReading(),
            userFilter: {
              email: filterOf(exact ? "grace.old@acme.test" : "grace.old"),
            },
          });

          expect(peopleIn(byNew)).toEqual([]);
          expect(peopleIn(byOld)).toEqual(["grace"]);
        },
      );

      test("a member is found by their own new address, and not by the old one", async () => {
        expect(
          peopleIn(
            await readUsersList({
              props: personReading(),
              userFilter: { email: new Search("bob.new") },
            }),
          ),
        ).toEqual(["bob"]);
        expect(
          peopleIn(
            await readUsersList({
              props: personReading(),
              userFilter: { email: new Search("bob.old") },
            }),
          ),
        ).toEqual([]);
      });

      test("a search on a part of every address finds everyone, as each row shows them", async () => {
        expect(
          peopleIn(
            await readUsersList({
              props: personReading(),
              userFilter: { email: new Search("acme.test") },
            }),
          ),
        ).toEqual(["bob", "grace", "hal", "reader"]);
      });

      test("a list of addresses finds Grace by the one she was invited at, never by her account's new one", async () => {
        expect(
          peopleIn(
            await readUsersList({
              props: personReading(),
              userFilter: {
                email: new Includes([
                  "aaa.grace.new@acme.test",
                  "bob.new@acme.test",
                ]),
              },
            }),
          ),
        ).toEqual(["bob"]);
        expect(
          peopleIn(
            await readUsersList({
              props: personReading(),
              userFilter: {
                email: new Includes([
                  "grace.old@acme.test",
                  "bob.new@acme.test",
                ]),
              },
            }),
          ),
        ).toEqual(["bob", "grace"]);
      });

      test("one of TypeORM's own operators, which cannot be read on another column, matches nobody pending", async () => {
        expect(
          peopleIn(
            await readUsersList({
              props: personReading(),
              userFilter: {
                email: In(["aaa.grace.new@acme.test", "bob.new@acme.test"]),
              },
            }),
          ),
        ).toEqual(["bob"]);
      });

      test("root still finds Grace by the address her account has", async () => {
        expect(
          peopleIn(
            await readUsersList({
              props: { isRoot: true },
              userFilter: { email: new Search("grace.new") },
            }),
          ),
        ).toEqual(["grace"]);
      });
    });

    describe("what an order says", () => {
      async function orderOf(
        values: Array<{ person: string; key: string }>,
        direction: "ASC" | "DESC",
      ): Promise<Array<string>> {
        const list: string = values
          .map((_entry: unknown, index: number): string => {
            return `($${index * 2 + 1}::text, $${index * 2 + 2}::text)`;
          })
          .join(", ");

        const rows: Array<{ person: string }> = await database.query(
          `SELECT "person" FROM (VALUES ${list}) AS "shown" ("person", "key") ORDER BY "key" ${direction}`,
          values.flatMap((entry: { person: string; key: string }) => {
            return [entry.person, entry.key];
          }),
        );

        return rows.map((row: { person: string }): string => {
          return row.person;
        });
      }

      test.each(["ASC", "DESC"] as Array<"ASC" | "DESC">)(
        "by address, %s: Grace falls where the address she was invited at does",
        async (direction: "ASC" | "DESC") => {
          const shown: Array<{ person: string }> = await readUsersList({
            props: personReading(),
            order: direction,
          });

          expect(
            shown.map((entry: { person: string }): string => {
              return entry.person;
            }),
          ).toEqual(
            await orderOf(
              [
                { person: "reader", key: "reader@acme.test" },
                { person: "bob", key: "bob.new@acme.test" },
                { person: "grace", key: "grace.old@acme.test" },
                { person: "hal", key: "hal@acme.test" },
              ],
              direction,
            ),
          );
        },
      );
    });

    describe("once she accepts", () => {
      test("the project sees, finds and orders her by her own address", async () => {
        for (const id of graceMemberships) {
          await database.query(
            `UPDATE "${schema}"."TeamMember" SET "hasAcceptedInvitation" = true WHERE "_id" = $1`,
            [id],
          );
        }

        try {
          const shown: Array<{ person: string; email: string }> =
            await readUsersList({ props: personReading() });

          expect(addressOf(shown, "grace")).toBe("aaa.grace.new@acme.test");
          expect(
            peopleIn(
              await readUsersList({
                props: personReading(),
                userFilter: { email: new Search("grace.new") },
              }),
            ),
          ).toEqual(["grace"]);
        } finally {
          for (const id of graceMemberships) {
            await database.query(
              `UPDATE "${schema}"."TeamMember" SET "hasAcceptedInvitation" = false WHERE "_id" = $1`,
              [id],
            );
          }
        }
      });
    });

    describe("the backfill (BackfillTeamMemberInviteeEmail)", () => {
      test("keeps, for each invitation still waiting with none, the address the project has been shown; nothing else", async () => {
        const before: Array<Row> = await database.query(
          `SELECT "_id", "inviteeEmail", "hasAcceptedInvitation" FROM "${schema}"."TeamMember" ORDER BY "_id"`,
        );

        await database.query(BACKFILL_TEAM_MEMBER_INVITEE_EMAIL_STATEMENT);
        const after: Array<Row> = await database.query(
          `SELECT "_id", "inviteeEmail", "hasAcceptedInvitation" FROM "${schema}"."TeamMember" ORDER BY "_id"`,
        );

        for (const row of after) {
          const was: Row | undefined = before.find(
            (candidate: Row): boolean => {
              return candidate["_id"] === row["_id"];
            },
          );

          if (row["hasAcceptedInvitation"]) {
            // A member keeps none: the project sees their own address.
            expect(row["inviteeEmail"]).toBe(was?.["inviteeEmail"] ?? null);
          } else if (was?.["inviteeEmail"]) {
            // An address an invitation kept stands.
            expect(row["inviteeEmail"]).toBe(was["inviteeEmail"]);
          } else {
            expect(typeof row["inviteeEmail"]).toBe("string");
          }
        }

        // Hal keeps the address his account has, which he has been shown by.
        const hal: Array<Row> = await database.query(
          `SELECT "inviteeEmail" FROM "${schema}"."TeamMember" WHERE "userId" = $1`,
          [people["hal"]],
        );
        expect(hal[0]?.["inviteeEmail"]).toBe("hal@acme.test");

        // Run again, it changes nothing.
        await database.query(BACKFILL_TEAM_MEMBER_INVITEE_EMAIL_STATEMENT);
        expect(
          await database.query(
            `SELECT "_id", "inviteeEmail", "hasAcceptedInvitation" FROM "${schema}"."TeamMember" ORDER BY "_id"`,
          ),
        ).toEqual(after);
      });
    });
  },
);
