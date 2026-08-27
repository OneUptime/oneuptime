import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import AggregateBy from "../../../Server/Types/Database/AggregateBy";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import BadDataException from "../../../Types/Exception/BadDataException";
import DatabaseNotConnectedException from "../../../Types/Exception/DatabaseNotConnectedException";
import { describe, expect, it } from "@jest/globals";
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

  /*
   * NOT tested here, deliberately: the same semicolon inside an `orderBy`
   * expression. aggregateBy validates orderBy expressions in a loop that runs
   * AFTER `this.buildAggregateScope(...)`, which calls getQueryBuilder, which
   * throws DatabaseNotConnectedException when Postgres is not up — so with no
   * database the call never reaches the orderBy check, and an assertion here
   * would be green for the wrong reason.
   *
   * Faking a connection would mean standing up half of TypeORM's DataSource,
   * which buys a test of the mock rather than of the method. Instead, the
   * source-text block at the bottom pins that the orderBy loop still calls
   * assertSafeAggregateExpression — deleting that call is the regression, and
   * that IS detectable from here.
   */
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

const READ_PERMISSION_SOURCE: string = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "..",
    "..",
    "Server",
    "Types",
    "Database",
    "Permissions",
    "ReadPermission.ts",
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

describe("the contract aggregateBy's own comments claim", () => {
  it("applies the permission query through setFindOptions, never by handing the object to .where()", () => {
    /*
     * This is the security-relevant one, and it is invisible from a black-box
     * call because both spellings produce a query that runs.
     *
     * ReadPermission.checkReadBlockPermission (asserted below) can hand back a
     * NESTED condition on the access-control relation — for a user holding a
     * label-blocked read permission it writes
     * `query[accessControlColumn] = { _id: notInOrNull(labelIds) }`.
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

  it("still has a nested access-control condition to protect", () => {
    /*
     * The assertion above is only worth having while checkReadBlockPermission
     * really does write a nested condition. If that ever became a flat clause,
     * the setFindOptions requirement would stop being load-bearing and the
     * comment explaining it would become folklore.
     */
    const READ_PERMISSION_CODE: string = squash(
      stripComments(READ_PERMISSION_SOURCE),
    );

    expect(READ_PERMISSION_CODE).toContain(
      "[model.getAccessControlColumn() as string] = { _id: QueryHelper.notInOrNull(labelIds)",
    );
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

  it("validates orderBy expressions too", () => {
    /*
     * The one guard this suite cannot exercise, because it sits after
     * buildAggregateScope() — which calls getQueryBuilder() and so needs a
     * live connection to reach (see the note in the statement-separator
     * block). Deleting the call is the regression; that much is visible from
     * here.
     */
    const orderByLoopStart: number = AGGREGATE_BY_BODY.indexOf(
      "aggregateBy.orderBy",
    );
    const orderByLoopEnd: number = AGGREGATE_BY_BODY.indexOf("addOrderBy");

    expect(orderByLoopStart).toBeGreaterThan(-1);
    expect(orderByLoopEnd).toBeGreaterThan(orderByLoopStart);
    expect(AGGREGATE_BY_BODY.slice(orderByLoopStart, orderByLoopEnd)).toContain(
      "assertSafeAggregateExpression(order.expression)",
    );
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
