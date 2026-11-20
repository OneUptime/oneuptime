import Entities from "../../../../Models/DatabaseModels/Index";
import Incident from "../../../../Models/DatabaseModels/Incident";
import MonitorOwnerUser from "../../../../Models/DatabaseModels/MonitorOwnerUser";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import PagedFind, {
  FindBuilderAdjuster,
} from "../../../../Server/Infrastructure/Postgres/PagedFind";
import TypeOrmPatchVersion from "../../../../Server/Infrastructure/Postgres/TypeOrmPatchVersion";
import PendingInviteeProfiles from "../../../../Server/Utils/TeamMember/PendingInviteeProfiles";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import UserType from "../../../../Types/UserType";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource, FindManyOptions, ObjectLiteral } from "typeorm";

/*
 * A LIST SORTED BY A PERSON'S NAME, ON POSTGRES (#9895).
 *
 * The Users list sorted by its User column, a team's Members, a monitor's
 * owners and the incidents by who declared them, read with the order
 * PendingInviteeProfiles gives a read (PagedFind's adjuster, which
 * DatabaseService hands every read). Someone only invited is ordered by
 * what their row shows - the name typed for them, else their address - and
 * everybody else by their own name, so where an invitee falls says nothing
 * of their account:
 *
 *   - before (TypeORM's order, as root reads): an invitee whose account is
 *     "Aaron Zed" and whose typed name is "Zoe Typed" came first;
 *   - after, for a person reading, they come where "Zoe Typed" does; an
 *     invitee with no typed name where their address does; someone the
 *     reader knows from another project of theirs by their own name;
 *   - an API key reads its project alone, so someone who joined only
 *     another project is pending to it;
 *   - the name typed in the request's project wins over a newer one typed
 *     elsewhere, as their row shows it;
 *   - both directions, empty names last, every page of every paging plan:
 *     one query, the id page from the table, TypeORM's two queries, and a
 *     TypeORM other than the one PagedFind was written for.
 *
 * The order each list should come in is asked of Postgres itself - the
 * values the rows show, ordered by the same database - so the suite holds
 * under any collation.
 *
 * Opt in with RUN_POSTGRES_PENDING_INVITEE_ORDER_TESTS=true against a
 * database the registered migrations have run on: the tables are copied
 * from public into a schema of the suite's own, every row is synthetic,
 * and the schema is dropped afterwards.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_PENDING_INVITEE_ORDER_TESTS"] === "true"
    ? describe
    : describe.skip;

type Row = Record<string, unknown>;

const NOW: number = Date.UTC(2026, 10, 20, 9, 0, 0);

const TABLES: ReadonlyArray<string> = [
  "Project",
  "Team",
  "User",
  "TeamMember",
  "Monitor",
  "MonitorOwnerUser",
  "Label",
  "Incident",
  "IncidentLabel",
];

describePostgres("a list sorted by a person's name, on Postgres", () => {
  const schema: string = `invitee_order_${ObjectID.generate().toString().split("-").join("")}`;
  let database: DataSource;
  let sequence: number = 0;

  // The project read, another of the reader's, and one the reader is not in.
  const projectId: string = ObjectID.generate().toString();
  const readerOtherProjectId: string = ObjectID.generate().toString();
  const strangerProjectId: string = ObjectID.generate().toString();

  const people: Record<string, string> = {};
  const teamIds: Record<string, string> = {};
  let monitorId: string = "";

  function nextId(): string {
    sequence++;
    return `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;
  }

  function at(minutes: number): Date {
    return new Date(NOW + minutes * 60 * 1000);
  }

  // NOT NULL columns with no default, filled with a value of their type.
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
        column.data_type === "integer" ||
        column.data_type === "bigint" ||
        column.data_type === "numeric" ||
        column.data_type === "smallint" ||
        column.data_type === "double precision"
      ) {
        fillers[column.column_name] = 0;
      } else if (column.data_type === "boolean") {
        fillers[column.column_name] = false;
      } else if (column.data_type.startsWith("timestamp")) {
        fillers[column.column_name] = at(0);
      } else if (column.data_type === "jsonb" || column.data_type === "json") {
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
    name: string | null,
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
    inviteeName?: string | null;
    minutes?: number;
  }): Promise<string> {
    return await insert("TeamMember", {
      projectId: data.project,
      teamId: teamIds[data.team],
      userId: people[data.person],
      hasAcceptedInvitation: data.accepted,
      inviteeName: data.inviteeName ?? null,
      createdAt: at(data.minutes || 0),
      updatedAt: at(data.minutes || 0),
    });
  }

  // Ids in the order Postgres orders these keys, ties by id: what a list should show.
  async function orderOfKeys(
    keyed: Array<{ id: string; key: string | null }>,
    direction: "ASC" | "DESC",
  ): Promise<Array<string>> {
    const values: string = keyed
      .map((_entry: { id: string; key: string | null }, index: number) => {
        return `($${index * 2 + 1}::uuid, $${index * 2 + 2}::text)`;
      })
      .join(", ");

    const rows: Array<{ id: string }> = await database.query(
      `SELECT "id" FROM (VALUES ${values}) AS "shown" ("id", "key") ORDER BY "key" ${direction} NULLS LAST, "id" ASC`,
      keyed.flatMap((entry: { id: string; key: string | null }) => {
        return [entry.id, entry.key];
      }),
    );

    return rows.map((row: { id: string }): string => {
      return row.id;
    });
  }

  function personReading(): DatabaseCommonInteractionProps {
    return {
      userId: new ObjectID(people["reader"]!),
      userType: UserType.User,
      tenantId: new ObjectID(projectId),
    };
  }

  function apiKeyReading(): DatabaseCommonInteractionProps {
    return {
      userType: UserType.API,
      tenantId: new ObjectID(projectId),
    };
  }

  function adjusterFor(
    props: DatabaseCommonInteractionProps,
  ): FindBuilderAdjuster {
    return PendingInviteeProfiles.getOrderAdjuster(props)!;
  }

  /*
   * The value each of the project's people shows the person reading - and
   * an API key, which reads the project alone.
   */
  function shownTo(reader: "person" | "apiKey"): Record<string, string | null> {
    return {
      reader: "Mona Reader",
      probe: "Nate Probe",
      bob: "Bob Member",
      nameless: null,
      // Account "Aaron Zed": only invited, typed "Zoe Typed".
      aaron: "Zoe Typed",
      // Account "Zachary Own": only invited, typed "Abby Typed".
      zach: "Abby Typed",
      // Account "Pat Own": only invited, nothing typed - their address.
      untyped: "mid.address@acme.test",
      // Joined another project of the person's: their own name to them.
      carla: reader === "person" ? "Carla Own" : "Yolanda Typed",
      // Typed "Pia Typed" here and, later, "Aaa Elsewhere" elsewhere.
      ben: "Pia Typed",
    };
  }

  // What TypeORM ordered by: every account's own name.
  const OWN_NAMES: Record<string, string | null> = {
    reader: "Mona Reader",
    probe: "Nate Probe",
    bob: "Bob Member",
    nameless: null,
    aaron: "Aaron Zed",
    zach: "Zachary Own",
    untyped: "Pat Own",
    carla: "Carla Own",
    ben: "Ben Own",
  };

  function keyOfPerson(
    userId: string,
    shown: Record<string, string | null>,
  ): string | null {
    const key: string | undefined = Object.keys(people).find(
      (candidate: string): boolean => {
        return people[candidate] === userId;
      },
    );

    expect(key).toBeDefined();

    return shown[key!] ?? null;
  }

  async function readMembers(data: {
    adjust: FindBuilderAdjuster | null;
    direction?: "ASC" | "DESC";
    teamId?: string;
    take?: number;
    skip?: number;
  }): Promise<Array<TeamMember>> {
    const direction: "ASC" | "DESC" = data.direction || "ASC";

    return await PagedFind.find(
      database.getRepository(TeamMember),
      {
        where: {
          projectId: new ObjectID(projectId),
          ...(data.teamId ? { teamId: new ObjectID(data.teamId) } : {}),
        },
        relations: { user: true },
        select: {
          _id: true,
          userId: true,
          user: { _id: true, name: true, email: true },
        },
        order: {
          user: {
            name:
              direction === "ASC"
                ? "ASC"
                : { direction: "DESC", nulls: "LAST" },
          },
          _id: "ASC",
        },
        ...(data.take !== undefined ? { take: data.take } : {}),
        ...(data.skip !== undefined ? { skip: data.skip } : {}),
      } as FindManyOptions<TeamMember>,
      data.adjust,
    );
  }

  async function expectedMembersOrder(
    shown: Record<string, string | null>,
    direction: "ASC" | "DESC",
    teamId?: string,
  ): Promise<Array<string>> {
    const rows: Array<{ _id: string; userId: string }> = await database.query(
      `SELECT "_id", "userId" FROM "${schema}"."TeamMember" WHERE "projectId" = $1 AND "deletedAt" IS NULL${
        teamId ? ` AND "teamId" = $2` : ""
      }`,
      teamId ? [projectId, teamId] : [projectId],
    );

    return await orderOfKeys(
      rows.map((row: { _id: string; userId: string }) => {
        return { id: row._id, key: keyOfPerson(row.userId, shown) };
      }),
      direction,
    );
  }

  function idsOf(rows: Array<ObjectLiteral>): Array<string> {
    return rows.map((row: ObjectLiteral): string => {
      return String(row["_id"]);
    });
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["PENDING_INVITEE_ORDER_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["PENDING_INVITEE_ORDER_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["PENDING_INVITEE_ORDER_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      // The order's own statements name "TeamMember" as any query does.
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    for (const id of [projectId, readerOtherProjectId, strangerProjectId]) {
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
      projectId: readerOtherProjectId,
      name: "Elsewhere",
      slug: `elsewhere-${sequence}`,
    });

    await person("reader", "Mona Reader", "reader@acme.test");
    await person("probe", "Nate Probe", "probe@acme.test");
    await person("bob", "Bob Member", "bob@acme.test");
    await person("nameless", null, "nameless@acme.test");
    await person("aaron", "Aaron Zed", "aaron@acme.test");
    await person("zach", "Zachary Own", "zach@acme.test");
    await person("untyped", "Pat Own", "mid.address@acme.test");
    await person("carla", "Carla Own", "carla@acme.test");
    await person("ben", "Ben Own", "ben@acme.test");

    // The reader, in the project and in another of theirs.
    await membership({
      person: "reader",
      project: projectId,
      team: "owners",
      accepted: true,
    });
    await membership({
      person: "reader",
      project: readerOtherProjectId,
      team: "elsewhere",
      accepted: true,
    });

    // Members: the reader's own second account among them.
    await membership({
      person: "probe",
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
    await membership({
      person: "nameless",
      project: projectId,
      team: "responders",
      accepted: true,
    });

    // Only invited, by the names typed for them, or none.
    await membership({
      person: "aaron",
      project: projectId,
      team: "responders",
      accepted: false,
      inviteeName: "Zoe Typed",
    });
    await membership({
      person: "zach",
      project: projectId,
      team: "responders",
      accepted: false,
      inviteeName: "  Abby Typed  ",
    });
    await membership({
      person: "untyped",
      project: projectId,
      team: "owners",
      accepted: false,
    });

    // Invited here, and joined another project of the reader's.
    await membership({
      person: "carla",
      project: projectId,
      team: "responders",
      accepted: false,
      inviteeName: "Yolanda Typed",
    });
    await membership({
      person: "carla",
      project: readerOtherProjectId,
      team: "elsewhere",
      accepted: true,
    });

    // Invited here, and later in another project of the reader's under another name.
    await membership({
      person: "ben",
      project: projectId,
      team: "responders",
      accepted: false,
      inviteeName: "Pia Typed",
      minutes: -60,
    });
    await membership({
      person: "ben",
      project: readerOtherProjectId,
      team: "elsewhere",
      accepted: false,
      inviteeName: "Aaa Elsewhere",
      minutes: 30,
    });

    // A monitor's owners: a member, and two people only invited.
    monitorId = await insert("Monitor", {
      projectId: projectId,
      name: "Checkout",
      slug: `checkout-${sequence}`,
    });

    for (const owner of ["bob", "aaron", "zach", "probe", "untyped"]) {
      await insert("MonitorOwnerUser", {
        projectId: projectId,
        monitorId: monitorId,
        userId: people[owner],
      });
    }

    // Incidents declared by each, with labels: a to-many relation to page with.
    const labelId: string = await insert("Label", {
      projectId: projectId,
      name: "customer-facing",
      slug: `customer-facing-${sequence}`,
    });

    for (const creator of [
      "bob",
      "aaron",
      "zach",
      "probe",
      "untyped",
      "carla",
    ]) {
      for (let copy: number = 0; copy < 2; copy++) {
        const incidentId: string = await insert("Incident", {
          projectId: projectId,
          title: `Declared by ${creator} ${copy}`,
          slug: `declared-by-${creator}-${copy}`,
          createdByUserId: people[creator],
          createdAt: at(copy),
        });

        await database.query(
          `INSERT INTO "${schema}"."IncidentLabel" ("incidentId", "labelId") VALUES ($1, $2)`,
          [incidentId, labelId],
        );
      }
    }
  }, 120000);

  afterAll(async () => {
    TypeOrmPatchVersion.setInstalledVersionForTests(undefined);

    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  test("before: TypeORM orders an invitee by their account's own name, which the rows withhold", async () => {
    const rows: Array<TeamMember> = await readMembers({ adjust: null });

    expect(idsOf(rows)).toEqual(await expectedMembersOrder(OWN_NAMES, "ASC"));

    // "Aaron Zed" first, though the row shows "Zoe Typed".
    expect(rows[0]!.userId!.toString()).toBe(people["aaron"]);
  });

  test("the Users list sorted by its User column: each person where the name their row shows falls", async () => {
    const rows: Array<TeamMember> = await readMembers({
      adjust: adjusterFor(personReading()),
    });

    expect(idsOf(rows)).toEqual(
      await expectedMembersOrder(shownTo("person"), "ASC"),
    );
    expect(idsOf(rows)).not.toEqual(
      await expectedMembersOrder(OWN_NAMES, "ASC"),
    );
  });

  test("descending, empty names last, as the header's second click sorts it", async () => {
    const rows: Array<TeamMember> = await readMembers({
      adjust: adjusterFor(personReading()),
      direction: "DESC",
    });

    expect(idsOf(rows)).toEqual(
      await expectedMembersOrder(shownTo("person"), "DESC"),
    );
    // The member with no name, last both ways.
    expect(rows[rows.length - 1]!.userId!.toString()).toBe(people["nameless"]);
  });

  test("an API key reads its project alone: someone who joined only another project is pending to it", async () => {
    const rows: Array<TeamMember> = await readMembers({
      adjust: adjusterFor(apiKeyReading()),
    });

    expect(idsOf(rows)).toEqual(
      await expectedMembersOrder(shownTo("apiKey"), "ASC"),
    );
  });

  test("a team's Members, sorted by name", async () => {
    const rows: Array<TeamMember> = await readMembers({
      adjust: adjusterFor(personReading()),
      teamId: teamIds["responders"],
    });

    expect(rows.length).toBeGreaterThan(3);
    expect(idsOf(rows)).toEqual(
      await expectedMembersOrder(
        shownTo("person"),
        "ASC",
        teamIds["responders"],
      ),
    );
  });

  test("every page, of every size, adds up to the whole list in its order", async () => {
    const whole: Array<string> = idsOf(
      await readMembers({ adjust: adjusterFor(personReading()) }),
    );

    for (const pageSize of [1, 2, 3, 4]) {
      const paged: Array<string> = [];

      for (let skip: number = 0; skip < whole.length; skip += pageSize) {
        paged.push(
          ...idsOf(
            await readMembers({
              adjust: adjusterFor(personReading()),
              take: pageSize,
              skip: skip,
            }),
          ),
        );
      }

      expect({ pageSize, paged }).toEqual({ pageSize, paged: whole });
    }
  });

  test("a monitor's owners, sorted by name", async () => {
    const rows: Array<MonitorOwnerUser> = await PagedFind.find(
      database.getRepository(MonitorOwnerUser),
      {
        where: { monitorId: new ObjectID(monitorId) },
        relations: { user: true },
        select: { _id: true, userId: true, user: { _id: true, name: true } },
        order: { user: { name: "ASC" }, _id: "ASC" },
        take: 10,
      } as FindManyOptions<MonitorOwnerUser>,
      adjusterFor(personReading()),
    );

    const shown: Record<string, string | null> = shownTo("person");

    expect(idsOf(rows)).toEqual(
      await orderOfKeys(
        rows.map((row: MonitorOwnerUser) => {
          return {
            id: String(row._id),
            key: keyOfPerson(row.userId!.toString(), shown),
          };
        }),
        "ASC",
      ),
    );
    expect(rows[0]!.userId!.toString()).toBe(people["zach"]);
  });

  /*
   * Incidents by who declared them, with their labels: a to-many relation
   * selected, so PagedFind takes the page's ids from the table, and
   * TypeORM's own read takes them in two queries over the joins.
   */
  async function expectedIncidentOrder(): Promise<Array<string>> {
    const rows: Array<{ _id: string; createdByUserId: string }> =
      await database.query(
        `SELECT "_id", "createdByUserId" FROM "${schema}"."Incident" WHERE "projectId" = $1`,
        [projectId],
      );
    const shown: Record<string, string | null> = shownTo("person");

    return await orderOfKeys(
      rows.map((row: { _id: string; createdByUserId: string }) => {
        return { id: row._id, key: keyOfPerson(row.createdByUserId, shown) };
      }),
      "ASC",
    );
  }

  const incidentOptions: (
    page?: { take: number; skip: number } | undefined,
  ) => FindManyOptions<Incident> = (
    page?: { take: number; skip: number } | undefined,
  ): FindManyOptions<Incident> => {
    return {
      where: { projectId: new ObjectID(projectId) },
      relations: { labels: true, createdByUser: true },
      select: {
        _id: true,
        labels: { _id: true },
        createdByUser: { _id: true, name: true },
      },
      order: { createdByUser: { name: "ASC" }, _id: "ASC" },
      take: page?.take ?? 100,
      ...(page ? { skip: page.skip } : {}),
    } as FindManyOptions<Incident>;
  };

  test("incidents by who declared them, each page's ids taken from the table", async () => {
    const expected: Array<string> = await expectedIncidentOrder();
    const paged: Array<string> = [];

    for (let skip: number = 0; skip < expected.length; skip += 5) {
      paged.push(
        ...idsOf(
          await PagedFind.find(
            database.getRepository(Incident),
            incidentOptions({ take: 5, skip: skip }),
            adjusterFor(personReading()),
          ),
        ),
      );
    }

    expect(paged).toEqual(expected);
  });

  test("incidents by who declared them, in TypeORM's own two queries", async () => {
    const expected: Array<string> = await expectedIncidentOrder();
    const paged: Array<string> = [];

    for (let skip: number = 0; skip < expected.length; skip += 5) {
      paged.push(
        ...idsOf(
          await PagedFind.createQueryBuilder(
            database.getRepository(Incident),
            incidentOptions({ take: 5, skip: skip }),
            adjusterFor(personReading()),
          ).getMany(),
        ),
      );
    }

    expect(paged).toEqual(expected);
  });

  test("on a TypeORM PagedFind was not written for, the same order", async () => {
    TypeOrmPatchVersion.setInstalledVersionForTests("0.3.0");

    try {
      const rows: Array<TeamMember> = await readMembers({
        adjust: adjusterFor(personReading()),
      });

      expect(idsOf(rows)).toEqual(
        await expectedMembersOrder(shownTo("person"), "ASC"),
      );
    } finally {
      TypeOrmPatchVersion.setInstalledVersionForTests(undefined);
    }
  });
});
