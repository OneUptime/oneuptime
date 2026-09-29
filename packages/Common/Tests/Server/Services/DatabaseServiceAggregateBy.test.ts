import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import AggregateBy from "../../../Server/Types/Database/AggregateBy";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import { CheckReadPermissionType } from "../../../Server/Types/Database/Permissions/ReadPermission";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import BadDataException from "../../../Types/Exception/BadDataException";
import DatabaseNotConnectedException from "../../../Types/Exception/DatabaseNotConnectedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { describe, expect, it } from "@jest/globals";
import { FindOperator } from "typeorm";
import fs from "fs";
import path from "path";

/*
 * `DatabaseService.aggregateBy` interpolates `AggregateColumn.expression` into
 * SQL verbatim. That is a deliberate trust boundary, documented in
 * AggregateBy.ts: expressions are compile-time constants owned by server code,
 * and every dynamic value goes through `parameters` as a `:name` placeholder
 * the driver binds.
 *
 * A documented contract is a comment. What is under test here is the half of
 * that contract the method ENFORCES — the structural half — because that is
 * what stands between "a constant with a `:siteId` placeholder" and "a
 * template literal somebody grew a request body into". The checks are a
 * tripwire on the constants-only rule rather than a sanitizer: an expression
 * assembled from request data can be perfectly valid single-statement SQL and
 * still be an injection, so the tripwire catches the one shape that turns a
 * leaked value into a SECOND statement, plus the alias, which has no parameter
 * form at all because it is structure.
 *
 * Every case below rejects before `checkReadQueryPermission` and before the
 * query builder is built, so this suite needs no database. That ordering is
 * itself pinned at the bottom of the file — if the validation ever moves after
 * the permission call, these tests would start passing for the wrong reason
 * (or failing on a missing connection), so it is not left to luck.
 */

const VALID_SELECT: AggregateBy<NetworkDevice>["select"] = [
  { expression: "COUNT(*)", alias: "totalDevices" },
];

/**
 * Calls aggregateBy with the given (deliberately bad) input and returns
 * whatever it threw.
 *
 * There is no database in this suite, so a call that gets PAST validation
 * throws DatabaseNotConnectedException instead — which is exactly how the
 * "accepted by the validator" case below proves acceptance without a
 * connection.
 */
async function aggregateError(
  overrides: Partial<AggregateBy<NetworkDevice>>,
): Promise<Error> {
  try {
    await NetworkDeviceService.aggregateBy({
      query: {},
      props: { isRoot: true },
      select: VALID_SELECT,
      ...overrides,
    });
  } catch (error) {
    return error as Error;
  }

  throw new Error(
    "aggregateBy resolved. The input under test was supposed to be rejected before it reached the database, and instead it was accepted.",
  );
}

describe("aggregateBy rejects a read that selects nothing", () => {
  it("rejects an empty select", async () => {
    /*
     * An aggregate with no aggregates is a `SELECT FROM` — TypeORM would fall
     * back to selecting the whole entity, which is precisely the row-shipping
     * read this primitive exists to replace.
     */
    const error: Error = await aggregateError({ select: [] });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe(
      "aggregateBy needs at least one aggregate column to select.",
    );
  });

  it("rejects an empty select even when there is a groupBy", async () => {
    // groupBy columns are selected too, so this could plausibly have been let through.
    const error: Error = await aggregateError({
      select: [],
      groupBy: [{ expression: `"NetworkDevice"."siteId"`, alias: "siteId" }],
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe(
      "aggregateBy needs at least one aggregate column to select.",
    );
  });
});

describe("aggregateBy rejects an alias that is not a plain identifier", () => {
  /*
   * An alias is interpolated into `AS "..."`. It is structure, not data, so
   * there is no placeholder form for it — the only defence is that it must
   * look like an identifier and nothing else. Each entry below is a way out of
   * the quotes.
   */
  const REJECTED_ALIASES: Array<[string, string]> = [
    ["a double quote closes the AS and starts new SQL", `total" , 1 AS "x`],
    ["a space introduces a second token", "total devices"],
    ["a semicolon starts a second statement", "total;"],
    ["a leading digit is not an identifier", "1total"],
    ["the empty string", ""],
    [
      "a keyword-shaped injection that escapes the quoted alias",
      `x" FROM "NetworkDevice" WHERE 1=1 --`,
    ],
    [
      "a hyphen, which also opens a SQL line comment when doubled",
      "total-devices",
    ],
    ["a dollar-quote opener", "total$$"],
    ["a newline, which hides the rest of the line in a log", "total\nAS y"],
  ];

  it.each(REJECTED_ALIASES)(
    "rejects an alias where %s",
    async (_reason: string, alias: string) => {
      const error: Error = await aggregateError({
        select: [{ expression: "COUNT(*)", alias: alias }],
      });

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe(
        `Invalid aggregate alias: ${alias}. Aliases must be plain identifiers.`,
      );
    },
  );

  it("rejects an invalid alias on a groupBy column too", async () => {
    /*
     * groupBy columns are concatenated in front of the select list and go
     * through the same loop. Checking only `select` would leave the group key
     * — the one column a caller is most tempted to name dynamically — unguarded.
     */
    const error: Error = await aggregateError({
      groupBy: [
        { expression: `"NetworkDevice"."vendor"`, alias: `vendor" , 1 AS "x` },
      ],
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe(
      `Invalid aggregate alias: vendor" , 1 AS "x. Aliases must be plain identifiers.`,
    );
  });

  it("rejects a leading underscore, which is a sharp edge worth knowing about", async () => {
    /*
     * Deliberately pinned, not endorsed. The pattern is /^[a-zA-Z][a-zA-Z0-9_]*$/,
     * so `_id` — the name of the primary key column on every model in this
     * repo — is NOT a legal alias. A caller grouping by id has to alias it
     * something else. If a future change loosens the pattern to allow a
     * leading underscore, that is a fine thing to do; update this test rather
     * than discovering the restriction from a 400 in production.
     */
    const error: Error = await aggregateError({
      groupBy: [{ expression: `"NetworkDevice"."_id"`, alias: "_id" }],
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe(
      "Invalid aggregate alias: _id. Aliases must be plain identifiers.",
    );
  });
});

describe("aggregateBy accepts a plain identifier", () => {
  /*
   * The other half of the alias tests. A validator that rejects everything is
   * also "safe" and completely useless, so the legal shapes have to be pinned
   * as well.
   *
   * With no database in this suite, "the validator accepted it" shows up as
   * the call getting all the way to `getRepository()` and failing there with
   * DatabaseNotConnectedException. A BadDataException here means the alias was
   * rejected; anything else means the shape of the method changed.
   */
  const ACCEPTED_ALIASES: Array<string> = [
    "a",
    "A",
    "totalDevices",
    "total_devices_down",
    "x9",
    "Vendor1",
    "a_1_b_2",
  ];

  it.each(ACCEPTED_ALIASES)("accepts %s", async (alias: string) => {
    const error: Error = await aggregateError({
      select: [{ expression: "COUNT(*)", alias: alias }],
    });

    expect(error).not.toBeInstanceOf(BadDataException);
    expect(error).toBeInstanceOf(DatabaseNotConnectedException);
  });
});

describe("aggregateBy rejects duplicate aliases", () => {
  it("rejects two select columns sharing an alias", async () => {
    /*
     * Postgres is perfectly happy to return two columns with the same label;
     * the driver then keys the raw row by name and the second silently wins.
     * "devicesDown" reading back the value of an unrelated count is a wrong
     * number that never throws — the exact failure class this whole change set
     * exists to remove.
     */
    const error: Error = await aggregateError({
      select: [
        {
          expression: `COUNT(*) FILTER (WHERE "NetworkDevice"."isReachable" = false)`,
          alias: "devicesDown",
        },
        {
          expression: `COUNT(*) FILTER (WHERE "NetworkDevice"."isReachable" IS NULL)`,
          alias: "devicesDown",
        },
      ],
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe("Duplicate aggregate alias: devicesDown.");
  });

  it("rejects a groupBy column that collides with a select column", async () => {
    /*
     * The collision that is easiest to write by accident, because the two
     * lists are written in different places and aggregateBy selects BOTH:
     * grouping by siteId while also selecting something aliased siteId. The
     * group KEY is the casualty, so every bucket would be attributed to the
     * wrong site.
     */
    const error: Error = await aggregateError({
      groupBy: [{ expression: `"NetworkDevice"."siteId"`, alias: "siteId" }],
      select: [
        { expression: `MIN("NetworkDevice"."siteId"::text)`, alias: "siteId" },
      ],
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe("Duplicate aggregate alias: siteId.");
  });

  it("rejects two groupBy columns sharing an alias", async () => {
    const error: Error = await aggregateError({
      groupBy: [
        { expression: `"NetworkDevice"."siteId"`, alias: "key" },
        { expression: `"NetworkDevice"."vendor"`, alias: "key" },
      ],
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe("Duplicate aggregate alias: key.");
  });

  it("is case sensitive, because Postgres quoted identifiers are", async () => {
    // "siteId" and "siteid" are different quoted identifiers, so this is not a duplicate.
    const error: Error = await aggregateError({
      select: [
        { expression: "COUNT(*)", alias: "siteId" },
        { expression: "COUNT(*)", alias: "siteid" },
      ],
    });

    expect(error).not.toBeInstanceOf(BadDataException);
    expect(error).toBeInstanceOf(DatabaseNotConnectedException);
  });
});

describe("aggregateBy rejects an expression carrying a statement separator", () => {
  it("rejects a semicolon in a select expression", async () => {
    const error: Error = await aggregateError({
      select: [
        {
          expression: `COUNT(*); DROP TABLE "NetworkDevice"`,
          alias: "totalDevices",
        },
      ],
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe(
      "Aggregate expressions cannot contain statement separators.",
    );
  });

  it("rejects a semicolon in a groupBy expression", async () => {
    const error: Error = await aggregateError({
      groupBy: [
        {
          expression: `"NetworkDevice"."vendor"; DELETE FROM "NetworkDevice"`,
          alias: "vendor",
        },
      ],
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe(
      "Aggregate expressions cannot contain statement separators.",
    );
  });

  it("rejects a semicolon wherever it sits in the expression", async () => {
    // Trailing, leading and mid-expression — the check is a containment test, and stays one.
    for (const expression of ["COUNT(*);", ";COUNT(*)", "COUNT(1) /* ; */"]) {
      const error: Error = await aggregateError({
        select: [{ expression: expression, alias: "totalDevices" }],
      });

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe(
        "Aggregate expressions cannot contain statement separators.",
      );
    }
  });

  it("rejects a semicolon in an orderBy expression", async () => {
    /*
     * This case used to carry a comment here explaining that it could not be
     * tested: the orderBy check ran inside the loop that APPLIES the order
     * clauses, below `this.buildAggregateScope(...)`, so with no Postgres the
     * call died on DatabaseNotConnectedException before ever reaching it.
     *
     * Production moved. aggregateBy now validates every orderBy expression in
     * a loop of its own, above the permission call and above the query
     * builder, with a comment saying it is placed there precisely so the
     * guard is reachable without a live connection. So the gap closes by
     * actually calling the method, which is worth more than the source-text
     * substitute further down: this fails if the check is deleted, if it
     * stops covering orderBy, or if it starts accepting a separator.
     *
     * The ordering that makes it reachable is itself asserted at the bottom
     * of the file, so this cannot quietly start passing for the wrong reason.
     */
    const error: Error = await aggregateError({
      orderBy: [
        {
          expression: `COUNT(*); DROP TABLE "NetworkDevice"`,
          sortOrder: SortOrder.Ascending,
        },
      ],
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe(
      "Aggregate expressions cannot contain statement separators.",
    );
  });
});

describe("aggregateBy rejects an empty expression", () => {
  it("rejects an empty string expression", async () => {
    const error: Error = await aggregateError({
      select: [{ expression: "", alias: "totalDevices" }],
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe("Aggregate expression cannot be empty.");
  });

  it("rejects a whitespace-only expression", async () => {
    /*
     * The shape a broken template literal collapses to. TypeORM would render
     * `SELECT  AS "totalDevices"`, which is a syntax error at the database —
     * a 500 with a driver message instead of a 400 that names the problem.
     */
    for (const expression of [" ", "   ", "\t", "\n", " \t\n "]) {
      const error: Error = await aggregateError({
        select: [{ expression: expression, alias: "totalDevices" }],
      });

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe("Aggregate expression cannot be empty.");
    }
  });

  it("rejects an empty groupBy expression", async () => {
    const error: Error = await aggregateError({
      groupBy: [{ expression: "  ", alias: "siteId" }],
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe("Aggregate expression cannot be empty.");
  });

  it("checks the expression before the alias", async () => {
    /*
     * Both are wrong here. Pinning which message wins is not pedantry: an
     * empty expression with a garbage alias is the shape of a
     * `${maybeUndefined}` template, and the expression message is the one that
     * points at the real defect.
     */
    const error: Error = await aggregateError({
      select: [{ expression: "", alias: "not a valid alias" }],
    });

    expect(error.message).toBe("Aggregate expression cannot be empty.");
  });
});

/*
 * The things about aggregateBy that no black-box call from this suite can
 * observe, and that a reasonable-looking edit could silently break. Read from
 * source, in the style of App/Tests/BaseAPI/NetworkSiteHierarchyDeviceRollup.test.ts.
 *
 * Comments are stripped before matching, so a doc comment that MENTIONS the
 * forbidden construct cannot make a check pass or fail by itself, and
 * whitespace is squashed so prettier re-wrapping a line cannot turn a real
 * regression check into a red herring.
 */
function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function sliceBetween(
  source: string,
  startMarker: string,
  endMarker: string,
): string {
  const start: number = source.indexOf(startMarker);
  const end: number = source.indexOf(endMarker, start + 1);

  if (start === -1 || end === -1) {
    throw new Error(
      `Could not slice DatabaseService.ts between "${startMarker}" and "${endMarker}" — the shape of the file changed, so these assertions are no longer pointing at what they name.`,
    );
  }

  return source.slice(start, end);
}

const DATABASE_SERVICE_SOURCE: string = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "..",
    "..",
    "Server",
    "Services",
    "DatabaseService.ts",
  ),
  "utf8",
);

/*
 * Just the body of aggregateBy, and just the body of the helper that builds
 * its scoped query builder. DatabaseService.ts is ~2,600 lines and uses
 * `.where(` legitimately all over it, so an assertion run against the whole
 * file could not fail for its own reason.
 */
const AGGREGATE_BY_BODY: string = squash(
  stripComments(
    sliceBetween(
      DATABASE_SERVICE_SOURCE,
      "public async aggregateBy(",
      "private buildAggregateScope(",
    ),
  ),
);

const BUILD_AGGREGATE_SCOPE_BODY: string = squash(
  stripComments(
    sliceBetween(
      DATABASE_SERVICE_SOURCE,
      "private buildAggregateScope(",
      "private queryTouchesARelation(",
    ),
  ),
);

/*
 * A reader whose grant on this model is LABEL-SCOPED: one tenant permission
 * row carrying labelIds, and nothing else. That is the only kind of caller for
 * whom the permission pipeline produces a condition on the access-control
 * relation, which is the shape the assertions below are about.
 *
 * Built the way ReadBlockPermission.test.ts builds its props, and deliberately
 * ProjectMember rather than a granular ReadNetworkDevice: ProjectMember is in
 * the read list of the table AND of every column the query below names, so a
 * failure here is a failure about the SHAPE of the returned query rather than
 * about a column-permission detail that has nothing to do with aggregates.
 *
 * That is a coupling to NetworkDevice's permission lists, so the caller
 * asserts it as an explicit precondition before calling the pipeline. A
 * tightening of those lists then reports itself as "ProjectMember is no longer
 * in the read list" rather than as a NotAuthorizedException from four files
 * away.
 */
function labelScopedReaderProps(
  projectId: ObjectID,
  permittedLabelId: ObjectID,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: projectId,
    _type: "UserTenantAccessPermission",
    permissions: [
      {
        _type: "UserPermission",
        permission: Permission.ProjectMember,
        labelIds: [permittedLabelId],
        isBlockPermission: false,
      },
    ],
  };

  return {
    userId: ObjectID.generate(),
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission,
    },
  };
}

/**
 * Every id a find operator carries, whatever slot the operator keeps them in.
 *
 * The point is to assert WHICH labels the permission pipeline let through
 * without asserting how the operator spells itself in SQL. QueryHelper builds
 * set membership as a TypeORM `Raw` today, whose ids live in
 * `objectLiteralParameters` and whose `value` is an empty array; TypeORM's own
 * `In([...])` would put the same ids in `value` and leave
 * `objectLiteralParameters` undefined. Both are the same invariant. Reading
 * both slots means a change of spelling inside QueryHelper — a file this suite
 * does not own, and whose rendered SQL an earlier version of the test below
 * pinned, to its cost — cannot redden this test while the invariant holds,
 * while anything that changes which ids are bound still does.
 *
 * Only strings are collected: an id is the one thing these operators bind as a
 * string, and a helper that also bound, say, a match count would bind that as
 * a number.
 */
function boundIdsOf(operator: FindOperator<unknown>): Array<string> {
  const parameters: Record<string, unknown> =
    (operator.objectLiteralParameters as Record<string, unknown> | undefined) ||
    {};

  const carried: Array<unknown> = [
    ...Object.values(parameters),
    operator.value,
  ];

  const ids: Array<string> = [];

  for (const entry of carried) {
    for (const value of Array.isArray(entry) ? entry : [entry]) {
      if (typeof value === "string") {
        ids.push(value);
      }
    }
  }

  return ids.sort();
}

describe("the contract aggregateBy's own comments claim", () => {
  it("applies the permission query through setFindOptions, never by handing the object to .where()", () => {
    /*
     * This is the security-relevant one, and it is invisible from a black-box
     * call because both spellings produce a query that runs.
     *
     * The permission pipeline (run for real below) can hand back a NESTED
     * condition on the access-control relation — for a user whose read grant
     * is label-scoped, the query comes back carrying
     * `query[accessControlColumn] = { _id: <the permitted labels> }`.
     * TypeORM's `.where(object)` renders FLAT conditions only: it has no
     * relation to join the nested object against, so it drops the clause
     * rather than erroring. The aggregate would then count rows the equivalent
     * findBy would hide, and a restricted user learns the size of a fleet they
     * cannot list. No exception, no log line — just a larger number.
     *
     * setFindOptions goes through the same FindOptions machinery findBy uses,
     * which joins the relation and applies the condition.
     *
     * The assertion is written as "the permission query object never reaches a
     * .where()" rather than "there is no .where() anywhere", because
     * buildAggregateScope deliberately calls `.where()` with a raw
     * `_id IN (subquery)` STRING to de-duplicate the relation join. That is a
     * different construct from handing it the query object, and only the
     * latter loses the nested condition.
     */
    expect(BUILD_AGGREGATE_SCOPE_BODY).toContain(
      "setFindOptions({ where: query as any })",
    );
    expect(AGGREGATE_BY_BODY).toContain(
      "this.buildAggregateScope(checkReadPermissionType.query)",
    );

    const HANDS_THE_QUERY_OBJECT_TO_WHERE: RegExp =
      /\.\s*(where|andWhere|orWhere)\s*\(\s*(query|checkReadPermissionType\.query)\b/;

    expect(AGGREGATE_BY_BODY).not.toMatch(HANDS_THE_QUERY_OBJECT_TO_WHERE);
    expect(BUILD_AGGREGATE_SCOPE_BODY).not.toMatch(
      HANDS_THE_QUERY_OBJECT_TO_WHERE,
    );
  });

  it("still has a nested access-control condition to protect", async () => {
    /*
     * The assertion above is only worth having while the permission pipeline
     * really does hand back a condition keyed on the access-control RELATION.
     * If every access-control predicate became a flat clause on a column of
     * the table itself, `.where(object)` would apply it perfectly well, the
     * de-duplicating subquery in buildAggregateScope would have nothing left
     * to de-duplicate, and the comment above would become folklore.
     *
     * This used to be a source-text match on ReadPermission.ts, pinned to the
     * exact expression checkReadBlockPermission wrote. That expression is
     * gone: a label BLOCK is now a flat `_id NOT IN (SELECT ... FROM the join
     * table)` predicate. That was a fix, not a regression — a relation join
     * cannot express "has none of these labels" at all (a device labelled
     * {blocked, other} still matches the join through its "other" row) — and
     * a flat predicate needs no join, so the block half cannot inflate an
     * aggregate either way.
     *
     * So nothing in this file asserts the block half any more, and that is a
     * decision rather than an oversight. There is no aggregate-specific
     * behaviour left to assert about it: with no relation key in the query,
     * queryTouchesARelation says no, buildAggregateScope takes the flat
     * `setFindOptions` branch, the same FindOptions machinery findBy uses
     * applies the predicate, and there is no join to de-duplicate. A reader
     * who holds a block AND a label-scoped allow puts the relation key back
     * in, which is the case this test already covers. The block predicate
     * itself belongs to ReadBlockPermission.test.ts, which owns it, and which
     * has to mock QueryUtil.getManyToManyRelationMetadata to reach it —
     * that helper returns null whenever Postgres is not connected, so a block
     * assertion here would have to bring the mock with it, into a suite whose
     * whole point is that it needs no database.
     *
     * The nested shape did not leave with it. It belongs to the ALLOW half,
     * which is the half that has always produced the join aggregateBy has to
     * survive: AccessControlPermission.addAccessControlIdsToQuery puts the
     * permitted label ids on the access-control column, and
     * QueryUtil.serializeQuery turns an id array on an EntityArray column
     * into `{ _id: <operator> }`.
     *
     * So this asks the pipeline rather than grepping whichever file happens
     * to spell it today: run the same call aggregateBy makes and look at what
     * comes back. It goes red if the label-scoped read stops producing a
     * relation-keyed condition — whether because the allow path moves to a
     * flat `_id` predicate the way the block path did, because serializeQuery
     * stops nesting the id filter under the relation, or because NetworkDevice
     * loses its access-control relation.
     *
     * If that day comes, a red here is NOT permission to delete the
     * setFindOptions requirement above, and it is not permission to quietly
     * rewrite this expectation either. This test watches ONE producer of
     * relation-keyed conditions, and there is at least one more:
     * `@CanAccessIfCanReadOn` makes BasePermission write
     * `query[relation] = { <the related model's access-control column>: ids }`
     * for StatusPageResource, IncidentInternalNote, AlertEpisodeMember,
     * OnCallDutyPolicyExecutionLogTimeline and others. queryTouchesARelation
     * cannot tell that key apart from this one, and `.where(object)` would
     * drop it just as silently — no exception, no log line, an aggregate over
     * rows the caller may not read.
     *
     * What has to be RE-ESTABLISHED before anything here is deleted is
     * therefore the whole claim rather than this one case: that NO read path —
     * label allow, label block, `@CanAccessIfCanReadOn`, owner scoping,
     * whatever has been added since — can still put a relation key in the
     * permitted query. Nobody has shown that. Until somebody does, a red here
     * means this particular case moved, and the test should follow it to
     * wherever the nested condition is produced now.
     *
     * No database is needed: the permission pipeline is pure right up to the
     * point DatabaseService hands the query to TypeORM.
     */
    const projectId: ObjectID = ObjectID.generate();
    const permittedLabelId: ObjectID = ObjectID.generate();
    const model: NetworkDevice = new NetworkDevice();

    /*
     * The two preconditions this test rests on, asserted rather than assumed.
     * ProjectMember is the permission the reader below is given; the moment it
     * stops being enough to read this table or the projectId column the query
     * filters on, checkReadQueryPermission throws NotAuthorizedException with
     * a message about permission names and nothing about aggregates. Whoever
     * tightens those lists should learn it from one line here rather than from
     * a confusing exception inside a test named after access-control
     * conditions — and the fix then is to give this reader a permission that
     * IS in both lists, not to change the lists back.
     */
    expect(model.getReadPermissions()).toContain(Permission.ProjectMember);
    expect(model.getColumnAccessControlFor("projectId")?.read || []).toContain(
      Permission.ProjectMember,
    );

    const permitted: CheckReadPermissionType<NetworkDevice> =
      await ModelPermission.checkReadQueryPermission(
        NetworkDevice,
        { projectId: projectId },
        null,
        labelScopedReaderProps(projectId, permittedLabelId),
      );

    const accessControlColumn: string | null = model.getAccessControlColumn();

    expect(accessControlColumn).toBeTruthy();

    /*
     * The key names a RELATION, not a column of this table. That is the whole
     * reason `.where(object)` cannot apply the condition and FindOptions has
     * to join for it.
     */
    const columnMetadata: TableColumnMetadata = model.getTableColumnMetadata(
      accessControlColumn as string,
    );

    expect(columnMetadata.type).toBe(TableColumnType.EntityArray);

    // And the condition under that key is NESTED: a filter on the RELATED row.
    const accessControlCondition: Record<string, unknown> = (
      permitted.query as any
    )[accessControlColumn as string];

    /*
     * `toBeTruthy`, not `toBeDefined`: the latter passes on null, and a null
     * under that key is one of the ways this could break. The `typeof` check
     * is the load-bearing half — a plain id string here instead of an object
     * would BE the "it went flat" regression this test exists to catch, and
     * a truthiness check alone would sail past it.
     */
    expect(accessControlCondition).toBeTruthy();
    expect(typeof accessControlCondition).toBe("object");

    const nestedIdFilter: unknown = accessControlCondition["_id"];

    expect(nestedIdFilter).toBeInstanceOf(FindOperator);

    /*
     * The identity above and the payload below, and deliberately nothing in
     * between. An earlier version of this assertion also read
     * `getSql("probe")` and pinned the substring `probe IN (`, which is
     * QueryHelper.in's chosen spelling — in a file this suite does not own.
     * Rendering the same set membership as `= ANY(:x)` would have reddened
     * this test with the invariant perfectly intact, which is precisely the
     * kind of coupling that made this test red once already.
     */
    expect(boundIdsOf(nestedIdFilter as FindOperator<unknown>)).toEqual([
      permittedLabelId.toString(),
    ]);
  });

  it("runs the query through ModelPermission.checkReadQueryPermission, like findBy and countBy", () => {
    /*
     * Tenant scoping lives in there. An aggregate that skipped it would count
     * across every project on the instance and report the total as one
     * project's fleet size.
     */
    expect(AGGREGATE_BY_BODY).toContain(
      "ModelPermission.checkReadQueryPermission(",
    );
    expect(AGGREGATE_BY_BODY).toContain("checkReadPermissionType.query");
  });

  it("validates orderBy expressions above the permission call, which is what makes them testable", () => {
    /*
     * The black-box test in the statement-separator block calls aggregateBy
     * with a semicolon in an orderBy expression and expects BadDataException.
     * It only reaches that check because the orderBy validation loop sits
     * ABOVE checkReadQueryPermission and above buildAggregateScope, which is
     * what keeps this suite database-free. Move the loop back down beside
     * addOrderBy and that test starts failing on a missing connection instead
     * — a confusing failure about jest rather than about the guard — so the
     * position is pinned here, where the message is about the position.
     */
    const orderByValidationAt: number = AGGREGATE_BY_BODY.indexOf(
      "assertSafeAggregateExpression(order.expression)",
    );
    const permissionAt: number = AGGREGATE_BY_BODY.indexOf(
      "checkReadQueryPermission",
    );
    const applyLoopAt: number = AGGREGATE_BY_BODY.indexOf("addOrderBy");

    expect(orderByValidationAt).toBeGreaterThan(-1);
    expect(permissionAt).toBeGreaterThan(-1);
    expect(applyLoopAt).toBeGreaterThan(-1);
    expect(orderByValidationAt).toBeLessThan(permissionAt);
    expect(applyLoopAt).toBeGreaterThan(permissionAt);
  });

  it("validates aliases and expressions before it touches permissions or the database", () => {
    /*
     * What makes every other test in this file database-free, stated as an
     * assertion so it cannot rot silently. If the alias/expression loop moved
     * below checkReadQueryPermission, the suite above would start failing on a
     * missing connection instead of on the message it asserts, and whoever hit
     * that would be debugging jest rather than reading this.
     */
    const validationAt: number = AGGREGATE_BY_BODY.indexOf(
      "aggregateAliasPattern",
    );
    const permissionAt: number = AGGREGATE_BY_BODY.indexOf(
      "checkReadQueryPermission",
    );
    const queryBuilderAt: number = AGGREGATE_BY_BODY.indexOf(
      "buildAggregateScope",
    );

    expect(validationAt).toBeGreaterThan(-1);
    expect(permissionAt).toBeGreaterThan(-1);
    expect(queryBuilderAt).toBeGreaterThan(-1);
    expect(validationAt).toBeLessThan(permissionAt);
    expect(permissionAt).toBeLessThan(queryBuilderAt);
  });
});
