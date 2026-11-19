import TeamService from "../../../Server/Services/TeamService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import Team from "../../../Models/DatabaseModels/Team";
import BadDataException from "../../../Types/Exception/BadDataException";
import { NAME_WHITE_SPACE_RUN_PATTERN } from "../../../Types/Database/UniqueName";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * TWO TEAMS OF A PROJECT NEVER SHARE A NAME (#9674).
 *
 * A team's name is all every picker shows of it - Invite User's Team, an
 * escalation rule's teams, an owner, a permission's teams - and two teams
 * called "Tenants" could be made, or a team renamed to another's name, so
 * nobody could tell which one they picked. TeamService now refuses, from its
 * unique-check hooks, once the caller may make the write:
 *
 *   - a new team named as another team of its project is named, however
 *     either is written (case, spaces, the kind of space);
 *   - a rename onto such a name;
 *   - one update that would give several teams one name.
 *
 * And lets through what must keep working:
 *   - a write that gives a team its own name again - an edit of its
 *     description sends the name it has - or its name in another case, so
 *     teams that already share a name can still be edited and renamed apart;
 *   - an update that does not write the name at all;
 *   - OneUptime's own writes: a new project's Owners, Admin and Members, and
 *     SCIM's groups, which the identity provider names.
 *
 * The other team is looked for as OneUptime: one the caller may not read
 * holds its name all the same. The hooks are reached through a structural
 * cast; the reads they make are stubbed and recorded.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const TEAM_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const SECOND_TEAM_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const CLASHING_TEAM_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const USER_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

// A spy, as getJestSpyOn hands it back.
type Spy = ReturnType<typeof getJestSpyOn>;

interface Hooks {
  onBeforeCreateUniqueCheck: (createBy: CreateBy<Team>) => Promise<void>;
  onBeforeUpdateUniqueCheck: (updateBy: UpdateBy<Team>) => Promise<void>;
}

const hooks: Hooks = TeamService as unknown as Hooks;

interface RawOperator {
  getSql: (alias: string) => string;
  objectLiteralParameters: Record<string, unknown>;
}

interface RecordedFind {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  props: Record<string, unknown>;
}

const MEMBER_PROPS: Record<string, unknown> = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
};

function team(data: {
  id: ObjectID;
  name: string;
  projectId?: ObjectID;
}): Team {
  const model: Team = new Team();
  model._id = data.id.toString();
  model.name = data.name;
  model.projectId = data.projectId || PROJECT_ID;
  return model;
}

/*
 * The other team the clash check finds - or none - and every find it made,
 * whole: what was asked is what these assert.
 */
function stubClash(clash: Team | null): Array<RecordedFind> {
  const finds: Array<RecordedFind> = [];

  getJestSpyOn(TeamService, "findOneBy").mockImplementation(
    async (findOneBy: RecordedFind): Promise<Team | null> => {
      finds.push(findOneBy);
      return clash;
    },
  );

  return finds;
}

// The teams the update writes, as the update path reads them.
function stubRowsWritten(rows: Array<Team>): Spy {
  return getJestSpyOn(
    TeamService,
    "findRowsAndHoldUpdateToThem",
  ).mockResolvedValue(rows);
}

function create(
  data: Record<string, unknown>,
  props?: Record<string, unknown>,
): Promise<void> {
  const model: Team = new Team();
  Object.assign(model, data);

  return hooks.onBeforeCreateUniqueCheck({
    data: model,
    props: props || MEMBER_PROPS,
  } as unknown as CreateBy<Team>);
}

function update(
  data: Record<string, unknown>,
  props?: Record<string, unknown>,
): Promise<void> {
  return hooks.onBeforeUpdateUniqueCheck({
    query: { _id: TEAM_ID.toString() },
    data: data,
    props: props || MEMBER_PROPS,
    limit: 1,
    skip: 0,
  } as unknown as UpdateBy<Team>);
}

async function refusal(write: Promise<void>): Promise<string> {
  try {
    await write;
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("Expected the write to be refused.");
}

// The name a find looked for, as Postgres reads it, and how.
function nameAskedFor(find: RecordedFind): {
  sql: string;
  values: Array<unknown>;
} {
  const operator: RawOperator = find.query["name"] as RawOperator;

  return {
    sql: operator.getSql('"Team"."name"'),
    values: Object.values(operator.objectLiteralParameters),
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a new team", () => {
  test("named as another team of its project is refused, with the name it was given", async () => {
    const finds: Array<RecordedFind> = stubClash(
      team({ id: CLASHING_TEAM_ID, name: "Tenants" }),
    );

    expect(
      await refusal(create({ name: "  tenants ", projectId: PROJECT_ID })),
    ).toBe(
      "There is already a team called tenants in this project. Pick another name.",
    );
    expect(finds).toHaveLength(1);
  });

  test("is compared in its own project, as it reads, as OneUptime", async () => {
    const finds: Array<RecordedFind> = stubClash(null);

    await create({ name: "Platform  Team", projectId: PROJECT_ID });

    expect(finds).toHaveLength(1);
    const find: RecordedFind = finds[0]!;

    expect(find.query["projectId"]).toEqual(PROJECT_ID);
    expect(find.query["_id"]).toBeUndefined();
    expect(find.props).toEqual({ isRoot: true });
    expect(find.select).toEqual({ _id: true });

    const asked: { sql: string; values: Array<unknown> } = nameAskedFor(find);

    expect(asked.sql).toContain(`LOWER(BTRIM(REGEXP_REPLACE("Team"."name"`);
    expect(asked.values).toEqual([
      "Platform  Team",
      NAME_WHITE_SPACE_RUN_PATTERN,
    ]);
  });

  test("with a name no other team has is let through", async () => {
    stubClash(null);

    await expect(
      create({ name: "Tenants", projectId: PROJECT_ID }),
    ).resolves.toBeUndefined();
  });

  test("named only by the request's project is compared there", async () => {
    const finds: Array<RecordedFind> = stubClash(null);

    await create({ name: "Tenants" });

    expect(finds[0]!.query["projectId"]).toEqual(PROJECT_ID);
  });

  test("with no name leaves it to the required check, and reads nothing", async () => {
    const finds: Array<RecordedFind> = stubClash(
      team({ id: CLASHING_TEAM_ID, name: "Tenants" }),
    );

    await create({ name: "   ", projectId: PROJECT_ID });
    await create({ projectId: PROJECT_ID });

    expect(finds).toHaveLength(0);
  });

  test("made by OneUptime itself - a new project's teams, SCIM's groups - is trusted", async () => {
    const finds: Array<RecordedFind> = stubClash(
      team({ id: CLASHING_TEAM_ID, name: "Tenants" }),
    );

    await create({ name: "Tenants", projectId: PROJECT_ID }, { isRoot: true });

    expect(finds).toHaveLength(0);
  });

  test("by a master admin is held to the rule like anyone's", async () => {
    stubClash(team({ id: CLASHING_TEAM_ID, name: "Tenants" }));

    expect(
      await refusal(
        create(
          { name: "Tenants", projectId: OTHER_PROJECT_ID },
          { isMasterAdmin: true, userId: USER_ID },
        ),
      ),
    ).toBe(
      "There is already a team called Tenants in this project. Pick another name.",
    );
  });
});

describe("renaming a team", () => {
  test("onto another team's name is refused", async () => {
    stubRowsWritten([team({ id: TEAM_ID, name: "Platform" })]);
    const finds: Array<RecordedFind> = stubClash(
      team({ id: CLASHING_TEAM_ID, name: "Tenants" }),
    );

    expect(await refusal(update({ name: "TENANTS" }))).toBe(
      "There is already a team called TENANTS in this project. Pick another name.",
    );

    // Any team of the project but the one renamed.
    const find: RecordedFind = finds[0]!;

    expect(find.query["projectId"]).toEqual(PROJECT_ID);
    expect((find.query["_id"] as RawOperator).getSql('"Team"."_id"')).toContain(
      "!=",
    );
    expect(
      Object.values((find.query["_id"] as RawOperator).objectLiteralParameters),
    ).toEqual([TEAM_ID.toString()]);
    expect(find.props).toEqual({ isRoot: true });
  });

  test("to a name no other team has is let through", async () => {
    stubRowsWritten([team({ id: TEAM_ID, name: "Platform" })]);
    stubClash(null);

    await expect(update({ name: "Platform Ops" })).resolves.toBeUndefined();
  });

  test("reads the teams the update writes, as the update path holds them", async () => {
    const rows: Spy = stubRowsWritten([
      team({ id: TEAM_ID, name: "Platform" }),
    ]);
    stubClash(null);

    await update({ name: "Platform Ops" });

    expect(rows).toHaveBeenCalledTimes(1);
    expect(rows.mock.calls[0]![1]).toEqual({
      _id: true,
      projectId: true,
      name: true,
    });
  });

  test.each([
    ["the same name", "Tenants"],
    ["its name in another case", "TENANTS"],
    ["its name with other spaces", " Tenants  "],
  ])(
    "with %s is no rename: never refused, though another team shares the name",
    async (_label: string, name: string) => {
      stubRowsWritten([team({ id: TEAM_ID, name: "Tenants" })]);
      const finds: Array<RecordedFind> = stubClash(
        team({ id: CLASHING_TEAM_ID, name: "Tenants" }),
      );

      await expect(
        update({ name: name, description: "For all tenants." }),
      ).resolves.toBeUndefined();
      expect(finds).toHaveLength(0);
    },
  );

  test("an edit that does not write the name reads nothing", async () => {
    const rows: Spy = stubRowsWritten([team({ id: TEAM_ID, name: "Tenants" })]);
    const finds: Array<RecordedFind> = stubClash(null);

    await update({ description: "For all tenants." });

    expect(rows).not.toHaveBeenCalled();
    expect(finds).toHaveLength(0);
  });

  test("one update giving several teams one name is refused", async () => {
    stubRowsWritten([
      team({ id: TEAM_ID, name: "Platform" }),
      team({ id: SECOND_TEAM_ID, name: "Billing" }),
    ]);
    const finds: Array<RecordedFind> = stubClash(null);

    expect(await refusal(update({ name: "Shared" }))).toBe(
      "Several teams cannot be given one name. Rename one team at a time.",
    );
    expect(finds).toHaveLength(0);
  });

  test("one update over several teams, one of which has the name already, renames just the other", async () => {
    stubRowsWritten([
      team({ id: TEAM_ID, name: "Platform" }),
      team({ id: SECOND_TEAM_ID, name: "shared" }),
    ]);
    const finds: Array<RecordedFind> = stubClash(null);

    await update({ name: "Shared" });

    expect(finds).toHaveLength(1);
    expect(
      Object.values(
        (finds[0]!.query["_id"] as RawOperator).objectLiteralParameters,
      ),
    ).toEqual([TEAM_ID.toString()]);
  });

  test("of a team the caller may not write reads no clash: the update writes nothing", async () => {
    stubRowsWritten([]);
    const finds: Array<RecordedFind> = stubClash(
      team({ id: CLASHING_TEAM_ID, name: "Tenants" }),
    );

    await update({ name: "Tenants" });

    expect(finds).toHaveLength(0);
  });

  test("by OneUptime itself - SCIM renaming a group - is trusted", async () => {
    const rows: Spy = stubRowsWritten([
      team({ id: TEAM_ID, name: "Platform" }),
    ]);
    const finds: Array<RecordedFind> = stubClash(
      team({ id: CLASHING_TEAM_ID, name: "Tenants" }),
    );

    await update({ name: "Tenants" }, { isRoot: true });

    expect(rows).not.toHaveBeenCalled();
    expect(finds).toHaveLength(0);
  });

  test("to a blank name or to something that is no text leaves it to the column's checks", async () => {
    const rows: Spy = stubRowsWritten([
      team({ id: TEAM_ID, name: "Platform" }),
    ]);
    stubClash(team({ id: CLASHING_TEAM_ID, name: "Tenants" }));

    await update({ name: "  " });
    await update({ name: 42 });
    await update({ name: null });

    expect(rows).not.toHaveBeenCalled();
  });
});
