import Entities from "../../../../Models/DatabaseModels/Index";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentOwnerUser from "../../../../Models/DatabaseModels/IncidentOwnerUser";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import PagedFind, {
  FindBuilderAdjuster,
} from "../../../../Server/Infrastructure/Postgres/PagedFind";
import TypeOrmPatchVersion from "../../../../Server/Infrastructure/Postgres/TypeOrmPatchVersion";
import PendingInviteeProfiles, {
  PROFILE_COLUMNS_SHOWN_ONCE_JOINED,
} from "../../../../Server/Utils/TeamMember/PendingInviteeProfiles";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ReadAudience from "../../../../Types/BaseDatabase/ReadAudience";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
import { customDomainCaller } from "../../API/CustomDomainCallers";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DataSource,
  FindManyOptions,
  ObjectLiteral,
  OrderByCondition,
  Repository,
  SelectQueryBuilder,
} from "typeorm";
import { EntityMetadata } from "typeorm/metadata/EntityMetadata";
import { RelationMetadata } from "typeorm/metadata/RelationMetadata";

/*
 * A LIST SORTED BY A PERSON'S NAME ORDERS SOMEONE ONLY INVITED BY WHAT THEIR
 * ROW SHOWS (#9895).
 *
 * A read ordered through a relation by a person's name - the Users list by
 * its User column, a team's Members, every list of owners or on-call
 * people, a record by who created it - was ordered by the account's own
 * name, so where someone only invited fell among the other rows said
 * something about the name the rows withheld: an inviter could rename an
 * account of their own and sort against it, a binary search over the name.
 *
 * Here, on builders made from every OneUptime model with no database (as
 * PagedFindSql does), the order PendingInviteeProfiles gives a read:
 *
 *   - every to-one relation to a person, in every model, ordered by their
 *     name, picture or two-factor flag, reads the value the reader sees:
 *     for someone pending, the name typed for them else their address, and
 *     no picture and no flag; for anyone else, their own;
 *   - in the read's own SQL, the id page's, and TypeORM's two-query page;
 *   - with the direction and the place of empty values the read asked for,
 *     and every other order left where it was;
 *   - for a person reading, an API key or a workflow (its project), and a
 *     run of OneUptime's own for a subject's readers (its project);
 *   - never for OneUptime's own reads, a master admin, or a reader the rule
 *     cannot be asked about, whose order is TypeORM's to the character;
 *   - and DatabaseService hands it to every read of the CRUD path.
 *
 * PendingInviteeOrderPostgres.test.ts holds the orders to real rows.
 */

let dataSource: DataSource;

const PROJECT_ID: ObjectID = new ObjectID(
  "98950000-4444-4000-8000-000000000001",
);

function member(): DatabaseCommonInteractionProps {
  return customDomainCaller({
    permissions: [Permission.ProjectMember],
    projectId: PROJECT_ID,
  });
}

function apiKey(): DatabaseCommonInteractionProps {
  return customDomainCaller({
    permissions: [Permission.ProjectAdmin],
    projectId: PROJECT_ID,
    isApiKey: true,
  });
}

function audience(): DatabaseCommonInteractionProps {
  const readAudience: ReadAudience = {
    _type: "ReadAudience",
    projectId: PROJECT_ID.toString(),
    ownedOnlyPermissions: [],
    labelledPermissions: [],
    named: {},
    telemetryBlockedIds: [],
  };

  return {
    isRoot: true,
    tenantId: PROJECT_ID,
    readAudience: readAudience,
  };
}

function repositoryOf<T extends ObjectLiteral>(target: {
  new (): T;
}): Repository<T> {
  return dataSource.getRepository<T>(target);
}

function adjusterFor(
  props: DatabaseCommonInteractionProps,
): FindBuilderAdjuster {
  const adjust: FindBuilderAdjuster | null =
    PendingInviteeProfiles.getOrderAdjuster(props);

  expect(adjust).not.toBeNull();

  return adjust!;
}

// Every to-one relation of a model to a person's account.
function relationsToPeople(): Array<{
  metadata: EntityMetadata;
  relation: RelationMetadata;
}> {
  const found: Array<{ metadata: EntityMetadata; relation: RelationMetadata }> =
    [];

  for (const metadata of dataSource.entityMetadatas) {
    for (const relation of metadata.relations) {
      const isToOne: boolean =
        relation.relationType === "many-to-one" ||
        (relation.relationType === "one-to-one" && relation.isOwning);

      if (isToOne && relation.inverseEntityMetadata.tableName === "User") {
        found.push({ metadata, relation });
      }
    }
  }

  return found;
}

// The order TypeORM itself builds for these options: its keys, as written.
function typeOrmOrderKeys<T extends ObjectLiteral>(
  repository: Repository<T>,
  options: FindManyOptions<T>,
): Array<string> {
  return Object.keys(
    PagedFind.createQueryBuilder(repository, options).expressionMap.orderBys,
  );
}

// The join alias an order through a relation names: "Alias.column" -> "Alias".
function aliasOfOrder(key: string): string {
  return key.substring(0, key.indexOf("."));
}

// The value a person is ordered by, as the rewritten builder selects it.
function orderedValueOf<T extends ObjectLiteral>(
  builder: SelectQueryBuilder<T>,
  orderKey: string,
): string {
  const selection: { selection: string; aliasName?: string } | undefined =
    builder.expressionMap.selects.find(
      (select: { selection: string; aliasName?: string }): boolean => {
        return select.aliasName === orderKey;
      },
    );

  expect(selection).toBeDefined();

  return selection!.selection;
}

beforeAll(async () => {
  dataSource = new DataSource({ type: "postgres", entities: Entities });
  await (
    dataSource as unknown as { buildMetadatas: () => Promise<void> }
  ).buildMetadatas();
});

afterEach(() => {
  TypeOrmPatchVersion.setInstalledVersionForTests(undefined);
  jest.restoreAllMocks();
});

describe("every list of people, sorted by a person's name", () => {
  test("every to-one relation to a person, in every model, orders a pending person by what their row shows", () => {
    const relations: Array<{
      metadata: EntityMetadata;
      relation: RelationMetadata;
    }> = relationsToPeople();

    // Owners, on-call people, creators, members: OneUptime has hundreds.
    expect(relations.length).toBeGreaterThan(100);

    const notRewritten: Array<string> = [];

    for (const { metadata, relation } of relations) {
      const repository: Repository<ObjectLiteral> = dataSource.getRepository(
        metadata.target,
      );
      const options: FindManyOptions<ObjectLiteral> = {
        order: { [relation.propertyName]: { name: "ASC" } },
        take: 10,
      } as FindManyOptions<ObjectLiteral>;

      const [typeOrmKey] = typeOrmOrderKeys(repository, options);
      const personAlias: string = aliasOfOrder(typeOrmKey!);

      const builder: SelectQueryBuilder<ObjectLiteral> =
        PagedFind.createQueryBuilder(
          repository,
          options,
          adjusterFor(member()),
        );

      const keys: Array<string> = Object.keys(builder.expressionMap.orderBys);
      const value: string | undefined = keys[0]
        ? builder.expressionMap.selects.find(
            (select: { selection: string; aliasName?: string }): boolean => {
              return select.aliasName === keys[0];
            },
          )?.selection
        : undefined;

      const isRewritten: boolean =
        keys.length === 1 &&
        keys[0]!.startsWith("pending_invitee_order_0_") &&
        Boolean(value) &&
        value!.startsWith(
          `(CASE WHEN "${personAlias}"."_id" IN (SELECT "pending`,
        ) &&
        value!.includes(`BTRIM("typed`) &&
        value!.includes(`"${personAlias}"."email")`) &&
        value!.endsWith(`ELSE "${personAlias}"."name" END)`) &&
        !builder.getQuery().includes(`"${personAlias}"."name" ASC`);

      if (!isRewritten) {
        notRewritten.push(`${metadata.name}.${relation.propertyName}`);
      }
    }

    expect(notRewritten).toEqual([]);
  });

  test.each([
    ["profilePictureId", "picture"],
    ["twoFactorAuthEnabled", "two-factor flag"],
  ])(
    "an order by a person's %s orders someone pending as having no %s",
    (column: string) => {
      const builder: SelectQueryBuilder<TeamMember> =
        PagedFind.createQueryBuilder(
          repositoryOf(TeamMember),
          {
            order: { user: { [column]: "DESC" } },
            take: 10,
          } as FindManyOptions<TeamMember>,
          adjusterFor(member()),
        );

      const key: string = Object.keys(builder.expressionMap.orderBys)[0]!;
      const value: string = orderedValueOf(builder, key);

      expect(value).toMatch(/^\(CASE WHEN "[^"]+"\."_id" IN \(SELECT "pending/);
      expect(value).toMatch(
        new RegExp(`THEN NULL ELSE "[^"]+"\\."${column}" END\\)$`),
      );
      // The name typed for someone is no picture and no flag.
      expect(value).not.toContain("inviteeName");
      expect(builder.expressionMap.orderBys[key]).toBe("DESC");
    },
  );

  test("the profile columns ordered are exactly those a pending person's row withholds", () => {
    expect([...PROFILE_COLUMNS_SHOWN_ONCE_JOINED].sort()).toEqual([
      "name",
      "profilePictureId",
      "twoFactorAuthEnabled",
    ]);
  });

  /*
   * A person's address, as their row shows it (#10175): someone pending is
   * ordered by the address they were invited at, else their account's -
   * never by the one their account has moved to, which where they fall
   * would otherwise spell out against addresses an inviter controls.
   */
  test("an order by a person's address orders someone pending by the address they were invited at", () => {
    const builder: SelectQueryBuilder<TeamMember> =
      PagedFind.createQueryBuilder(
        repositoryOf(TeamMember),
        {
          order: { user: { email: "DESC" } },
          take: 10,
        } as FindManyOptions<TeamMember>,
        adjusterFor(member()),
      );

    const key: string = Object.keys(builder.expressionMap.orderBys)[0]!;
    const value: string = orderedValueOf(builder, key);

    expect(key).toMatch(/^pending_invitee_order_0_/);
    expect(value).toMatch(/^\(CASE WHEN "([^"]+)"\."_id" IN \(SELECT "pending/);
    expect(value).toMatch(
      /THEN COALESCE\(\(SELECT BTRIM\("invited[A-Za-z]{10}"\."inviteeEmail"\)/,
    );
    expect(value).toMatch(/, "[^"]+"\."email"\) ELSE "[^"]+"\."email" END\)$/);
    // The name typed for someone is no address.
    expect(value).not.toContain("inviteeName");
    expect(builder.expressionMap.orderBys[key]).toBe("DESC");
    expect(builder.getQuery()).not.toMatch(/"[^"]+"\."email" DESC/);
  });

  test("every to-one relation to a person, in every model, orders a pending person by the address their row shows", () => {
    const notRewritten: Array<string> = [];

    for (const { metadata, relation } of relationsToPeople()) {
      const repository: Repository<ObjectLiteral> = dataSource.getRepository(
        metadata.target,
      );
      const options: FindManyOptions<ObjectLiteral> = {
        order: { [relation.propertyName]: { email: "ASC" } },
        take: 10,
      } as FindManyOptions<ObjectLiteral>;

      const [typeOrmKey] = typeOrmOrderKeys(repository, options);
      const personAlias: string = aliasOfOrder(typeOrmKey!);

      const builder: SelectQueryBuilder<ObjectLiteral> =
        PagedFind.createQueryBuilder(
          repository,
          options,
          adjusterFor(member()),
        );

      const keys: Array<string> = Object.keys(builder.expressionMap.orderBys);
      const value: string | undefined = keys[0]
        ? builder.expressionMap.selects.find(
            (select: { selection: string; aliasName?: string }): boolean => {
              return select.aliasName === keys[0];
            },
          )?.selection
        : undefined;

      const isRewritten: boolean =
        keys.length === 1 &&
        keys[0]!.startsWith("pending_invitee_order_0_") &&
        Boolean(value) &&
        value!.startsWith(
          `(CASE WHEN "${personAlias}"."_id" IN (SELECT "pending`,
        ) &&
        value!.includes(`BTRIM("invited`) &&
        value!.endsWith(`ELSE "${personAlias}"."email" END)`) &&
        !builder.getQuery().includes(`"${personAlias}"."email" ASC`);

      if (!isRewritten) {
        notRewritten.push(`${metadata.name}.${relation.propertyName}`);
      }
    }

    expect(notRewritten).toEqual([]);
  });

  test("an order by a person's name falls back to the address they were invited at, when no name was typed", () => {
    const builder: SelectQueryBuilder<TeamMember> =
      PagedFind.createQueryBuilder(
        repositoryOf(TeamMember),
        {
          order: { user: { name: "ASC" } },
          take: 10,
        } as FindManyOptions<TeamMember>,
        adjusterFor(member()),
      );

    const value: string = orderedValueOf(
      builder,
      Object.keys(builder.expressionMap.orderBys)[0]!,
    );

    expect(value).toMatch(
      /THEN COALESCE\(\(SELECT BTRIM\("typed[A-Za-z]{10}"\."inviteeName"\)[\s\S]*\), COALESCE\(\(SELECT BTRIM\("invited[A-Za-z]{10}"\."inviteeEmail"\)/,
    );
  });

  test("a read ordered by its own columns, or by a related record that is no person, is TypeORM's to the character", () => {
    for (const options of [
      { order: { createdAt: "DESC" }, take: 10 },
      { order: { team: { name: "ASC" } }, take: 10 },
      { order: { project: { name: "DESC" } }, take: 10 },
      { take: 10 },
    ] as Array<FindManyOptions<TeamMember>>) {
      const typeOrm: SelectQueryBuilder<TeamMember> =
        PagedFind.createQueryBuilder(repositoryOf(TeamMember), options);
      const adjusted: SelectQueryBuilder<TeamMember> =
        PagedFind.createQueryBuilder(
          repositoryOf(TeamMember),
          options,
          adjusterFor(member()),
        );

      expect(adjusted.getQuery()).toBe(typeOrm.getQuery());
      expect(adjusted.getParameters()).toEqual(typeOrm.getParameters());
    }
  });
});

describe("the order around it", () => {
  test("keeps its place among the other orders, its direction and where empty values go", () => {
    const builder: SelectQueryBuilder<TeamMember> =
      PagedFind.createQueryBuilder(
        repositoryOf(TeamMember),
        {
          order: {
            hasAcceptedInvitation: "DESC",
            user: { name: { direction: "DESC", nulls: "LAST" } },
            _id: "ASC",
          },
          take: 25,
          skip: 25,
        } as FindManyOptions<TeamMember>,
        adjusterFor(member()),
      );

    const orderBys: OrderByCondition = builder.expressionMap.orderBys;
    const keys: Array<string> = Object.keys(orderBys);

    expect(keys).toHaveLength(3);
    expect(keys[0]).toBe("TeamMember.hasAcceptedInvitation");
    expect(keys[1]).toMatch(/^pending_invitee_order_0_[a-z]+$/);
    expect(keys[2]).toBe("TeamMember._id");
    expect(orderBys[keys[1]!]).toEqual({
      order: "DESC",
      nulls: "NULLS LAST",
    });

    expect(builder.getQuery()).toContain(
      `ORDER BY "TeamMember"."hasAcceptedInvitation" DESC, ${keys[1]} DESC NULLS LAST, "TeamMember"."_id" ASC`,
    );
  });

  test("a read ordered by a person's name and their picture orders by both, each as the reader sees it", () => {
    const builder: SelectQueryBuilder<TeamMember> =
      PagedFind.createQueryBuilder(
        repositoryOf(TeamMember),
        {
          order: {
            user: { name: "ASC", profilePictureId: "ASC" },
          },
          take: 10,
        } as FindManyOptions<TeamMember>,
        adjusterFor(member()),
      );

    const keys: Array<string> = Object.keys(builder.expressionMap.orderBys);

    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^pending_invitee_order_0_/);
    expect(keys[1]).toMatch(/^pending_invitee_order_1_/);
    expect(orderedValueOf(builder, keys[0]!)).toContain("inviteeName");
    expect(orderedValueOf(builder, keys[1]!)).toContain("THEN NULL");
  });

  test("through two relations: an owner row ordered by its incident's creator", () => {
    const builder: SelectQueryBuilder<IncidentOwnerUser> =
      PagedFind.createQueryBuilder(
        repositoryOf(IncidentOwnerUser),
        {
          order: { incident: { createdByUser: { name: "ASC" } } },
          take: 10,
        } as FindManyOptions<IncidentOwnerUser>,
        adjusterFor(member()),
      );

    const key: string = Object.keys(builder.expressionMap.orderBys)[0]!;

    expect(key).toMatch(/^pending_invitee_order_0_/);
    expect(orderedValueOf(builder, key)).toContain("inviteeName");
  });

  test("the id page a read takes from its own table is ordered the same way", () => {
    const repository: Repository<Incident> = repositoryOf(Incident);
    const options: FindManyOptions<Incident> = {
      // A to-many relation selected only: the page's ids come from the table.
      relations: { labels: true },
      select: { _id: true, labels: { _id: true } },
      order: { createdByUser: { name: "ASC" }, _id: "ASC" },
      take: 10,
    } as FindManyOptions<Incident>;

    const adjust: FindBuilderAdjuster = adjusterFor(member());
    const full: SelectQueryBuilder<Incident> = PagedFind.createQueryBuilder(
      repository,
      options,
      adjust,
    );
    const idPage: SelectQueryBuilder<Incident> | null =
      PagedFind.createIdPageQueryBuilder(repository, options, full, adjust);

    expect(idPage).not.toBeNull();

    const key: string = Object.keys(idPage!.expressionMap.orderBys)[0]!;

    expect(key).toMatch(/^pending_invitee_order_0_/);
    expect(idPage!.getQuery()).toContain(`ORDER BY ${key} ASC`);
    expect(orderedValueOf(idPage!, key)).toContain("inviteeName");
  });

  test("TypeORM's own two-query page orders the page's ids by the value it selects", () => {
    const builder: SelectQueryBuilder<Incident> = PagedFind.createQueryBuilder(
      repositoryOf(Incident),
      {
        relations: { labels: true, createdByUser: true },
        select: {
          _id: true,
          labels: { _id: true },
          createdByUser: { _id: true, name: true },
        },
        order: { createdByUser: { name: "ASC" }, _id: "ASC" },
        take: 10,
        skip: 10,
      } as FindManyOptions<Incident>,
      adjusterFor(member()),
    );

    const key: string = Object.keys(builder.expressionMap.orderBys)[0]!;

    // TypeORM pages a to-many read in two queries: the ids by these orders.
    expect(PagedFind.isTypeOrmTwoQueryPage(builder)).toBe(true);

    const [selects, orderBys] = (
      builder as unknown as {
        createOrderByCombinedWithSelectExpression: (
          parentAlias: string,
        ) => [string, Record<string, unknown>];
      }
    ).createOrderByCombinedWithSelectExpression("distinctAlias");

    expect(selects).toContain(`"distinctAlias"."${key}"`);
    expect(Object.keys(orderBys)[0]).toBe(`"distinctAlias"."${key}"`);
  });
});

describe("who reads", () => {
  test("a person: their projects are those they have a membership in, and they are never pending to themselves", () => {
    const props: DatabaseCommonInteractionProps = member();
    const builder: SelectQueryBuilder<TeamMember> =
      PagedFind.createQueryBuilder(
        repositoryOf(TeamMember),
        {
          order: { user: { name: "ASC" } },
          take: 10,
        } as FindManyOptions<TeamMember>,
        adjusterFor(props),
      );

    const key: string = Object.keys(builder.expressionMap.orderBys)[0]!;
    const value: string = orderedValueOf(builder, key);
    const parameters: Record<string, unknown> = builder.getParameters();
    const readerParameter: string = Object.keys(parameters).find(
      (name: string): boolean => {
        return name.startsWith("pendingInviteeOrderReader");
      },
    )!;
    const projectParameter: string = Object.keys(parameters).find(
      (name: string): boolean => {
        return name.startsWith("pendingInviteeOrderProject");
      },
    )!;

    expect(parameters[readerParameter]).toBe(
      props.userId!.toString().toLowerCase(),
    );
    // The request's project first, among the names typed for someone.
    expect(parameters[projectParameter]).toBe(
      PROJECT_ID.toString().toLowerCase(),
    );
    expect(value).toContain(`"userId" = :${readerParameter}`);
    expect(value).toContain(`"userId" <> :${readerParameter}`);
    expect(value).toContain(
      `CASE WHEN "typed${readerParameter.substring("pendingInviteeOrderReader".length)}"."projectId" = :${projectParameter} THEN 0 ELSE 1 END`,
    );
  });

  test("an API key or a workflow: its own project", () => {
    const builder: SelectQueryBuilder<TeamMember> =
      PagedFind.createQueryBuilder(
        repositoryOf(TeamMember),
        {
          order: { user: { name: "ASC" } },
          take: 10,
        } as FindManyOptions<TeamMember>,
        adjusterFor(apiKey()),
      );

    const key: string = Object.keys(builder.expressionMap.orderBys)[0]!;
    const value: string = orderedValueOf(builder, key);
    const parameters: Record<string, unknown> = builder.getParameters();
    const readerParameter: string = Object.keys(parameters).find(
      (name: string): boolean => {
        return name.startsWith("pendingInviteeOrderReader");
      },
    )!;

    expect(parameters[readerParameter]).toBe(
      PROJECT_ID.toString().toLowerCase(),
    );
    expect(value).toContain(`"projectId" IN (:${readerParameter})`);
    // A project is nobody: no reader to leave out.
    expect(value).not.toContain(`"userId" <> :`);
  });

  test("a workflow reads as its project too", () => {
    const props: DatabaseCommonInteractionProps = {
      ...apiKey(),
      userType: UserType.Workflow,
    };

    expect(PendingInviteeProfiles.getOrderAdjuster(props)).not.toBeNull();
  });

  test("a run of OneUptime's own for a subject's readers reads as their project", () => {
    const builder: SelectQueryBuilder<TeamMember> =
      PagedFind.createQueryBuilder(
        repositoryOf(TeamMember),
        {
          order: { user: { name: "ASC" } },
          take: 10,
        } as FindManyOptions<TeamMember>,
        adjusterFor(audience()),
      );

    const parameters: Record<string, unknown> = builder.getParameters();

    expect(Object.values(parameters)).toContain(
      PROJECT_ID.toString().toLowerCase(),
    );
    expect(Object.keys(builder.expressionMap.orderBys)[0]).toMatch(
      /^pending_invitee_order_0_/,
    );
  });

  test.each([
    ["OneUptime's own read", { isRoot: true }],
    [
      "a master admin",
      {
        isMasterAdmin: true,
        userId: ObjectID.generate(),
        tenantId: PROJECT_ID,
      },
    ],
    ["a reader the rule cannot be asked about", {}],
    ["a public page with no project", { userType: UserType.Public }],
  ])(
    "%s: no change, TypeORM's order to the character",
    (_case: string, props: DatabaseCommonInteractionProps) => {
      expect(PendingInviteeProfiles.getOrderAdjuster(props)).toBeNull();
    },
  );
});

describe("on a TypeORM PagedFind was not written for", () => {
  test("the read is still ordered as its reader sees it: TypeORM's own builder, adjusted", async () => {
    TypeOrmPatchVersion.setInstalledVersionForTests("0.3.0");

    const built: Array<SelectQueryBuilder<ObjectLiteral>> = [];

    jest
      .spyOn(SelectQueryBuilder.prototype, "getMany")
      .mockImplementation(async function (
        this: SelectQueryBuilder<ObjectLiteral>,
      ): Promise<Array<ObjectLiteral>> {
        built.push(this);
        return [];
      });

    await PagedFind.find(
      repositoryOf(TeamMember),
      {
        order: { user: { name: "ASC" } },
        take: 10,
      } as FindManyOptions<TeamMember>,
      adjusterFor(member()),
    );

    expect(built).toHaveLength(1);
    expect(Object.keys(built[0]!.expressionMap.orderBys)[0]).toMatch(
      /^pending_invitee_order_0_/,
    );
  });

  test("with no adjuster, repository.find as ever", async () => {
    TypeOrmPatchVersion.setInstalledVersionForTests("0.3.0");

    const find: ReturnType<typeof jest.spyOn> = jest
      .spyOn(repositoryOf(TeamMember), "find")
      .mockResolvedValue([]);

    await PagedFind.find(repositoryOf(TeamMember), { take: 10 });

    expect(find).toHaveBeenCalledTimes(1);
  });
});

describe("every read of the CRUD path", () => {
  test("DatabaseService hands PagedFind the asker's order", () => {
    const source: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "Server",
        "Services",
        "DatabaseService.ts",
      ),
      "utf8",
    );

    expect(source).toContain(
      "PendingInviteeProfiles.getOrderAdjuster(narrowed.asker),",
    );
    // The one find of the read path, and the one that takes it.
    expect(source.match(/PagedFind\.find\(/g) || []).toHaveLength(1);
  });
});
