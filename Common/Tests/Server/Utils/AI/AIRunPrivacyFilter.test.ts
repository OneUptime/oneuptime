import {
  applyAIRunPrivacyFilter,
  getAIRunPrivacyRaw,
} from "../../../../Server/Utils/AI/AIRunPrivacyFilter";
import QueryUtil from "../../../../Server/Types/Database/QueryUtil";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunType from "../../../../Types/AI/AIRunType";
import Query from "../../../../Types/BaseDatabase/Query";
import EqualToOrNull from "../../../../Types/BaseDatabase/EqualToOrNull";
import Includes from "../../../../Types/BaseDatabase/Includes";
import IsNull from "../../../../Types/BaseDatabase/IsNull";
import LessThan from "../../../../Types/BaseDatabase/LessThan";
import MultiSearch from "../../../../Types/BaseDatabase/MultiSearch";
import NotContains from "../../../../Types/BaseDatabase/NotContains";
import NotEqual from "../../../../Types/BaseDatabase/NotEqual";
import NotNull from "../../../../Types/BaseDatabase/NotNull";
import Search from "../../../../Types/BaseDatabase/Search";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import { UserTenantAccessPermission } from "../../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * The forced privacy clause must survive every operator a client can smuggle
 * into query.runType. BaseAPI.getList takes `query` straight from the request
 * body and JSONFunctions.deserializeValue rebuilds any operator named via
 * `_type`, so these are all reachable from an ordinary HTTP call.
 *
 * Every assertion runs against the FINAL query — after QueryUtil.serializeQuery
 * — because that is what actually reaches the database. Asserting on the
 * pre-hook object would pass even for an implementation that reads (and is
 * fooled by) the caller's runType.
 */

const userId: ObjectID = ObjectID.generate();

type SerializeFunction = (
  query: Record<string, unknown>,
) => Record<string, unknown>;

const serialize: SerializeFunction = (
  query: Record<string, unknown>,
): Record<string, unknown> => {
  const filtered: Record<string, unknown> = applyAIRunPrivacyFilter(query, {
    userId: userId,
  });

  return QueryUtil.serializeQuery(
    AIRun,
    filtered as Query<AIRun>,
  ) as unknown as Record<string, unknown>;
};

/*
 * Renders a (possibly nested) TypeORM FindOperator tree to text so the
 * assertions can look for the forced predicate inside an And(...).
 */
type RenderFunction = (value: unknown) => string;

const render: RenderFunction = (value: unknown): string => {
  const parts: Array<string> = [];

  const walk: (node: unknown) => void = (node: unknown): void => {
    if (!(node instanceof FindOperator)) {
      if (node !== undefined && node !== null) {
        parts.push(String(node));
      }
      return;
    }

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const operator: any = node as any;

    parts.push(String(operator._type));

    if (typeof operator._getSql === "function") {
      try {
        parts.push(String(operator._getSql("COLUMN")));
      } catch {
        // Raw's sql builder only needs the alias; ignore anything that throws.
      }
    }

    const innerValue: any = operator._value;
    /* eslint-enable @typescript-eslint/no-explicit-any */

    if (Array.isArray(innerValue)) {
      innerValue.forEach(walk);
      return;
    }

    walk(innerValue);
  };

  walk(value);

  return parts.join(" | ");
};

type AssertFunction = (serialized: Record<string, unknown>) => void;

// The forced disjunction must be present in whatever finally lands on runType.
const expectPrivacyClauseSurvives: AssertFunction = (
  serialized: Record<string, unknown>,
): void => {
  const runType: unknown = serialized["runType"];

  expect(runType).toBeInstanceOf(FindOperator);
  expect(render(runType)).toContain(`"AIRun"."userId"`);
};

describe("getAIRunPrivacyRaw", () => {
  test("root and master admin bypass the filter entirely", () => {
    expect(getAIRunPrivacyRaw({ isRoot: true })).toBeUndefined();
    expect(getAIRunPrivacyRaw({ isMasterAdmin: true })).toBeUndefined();
  });

  /*
   * BLOCKING guarantee. Project API keys are given userTenantAccessPermission
   * but never userAuthorization, so props.userId is undefined for them and
   * this throw is their hard block on AIRun. Letting CodeFix rows through for
   * a caller with no user would hand every ProjectMember API key the whole
   * project fix history — access neither /ai-run nor /code-fix-run grants.
   */
  test("rejects a caller with no user, even though CodeFix runs are shared", () => {
    const apiKeyShapedProps: DatabaseCommonInteractionProps = {
      tenantId: ObjectID.generate(),
      userTenantAccessPermission: {} as {
        [tenantId: string]: UserTenantAccessPermission;
      },
    };

    expect(() => {
      return getAIRunPrivacyRaw(apiKeyShapedProps);
    }).toThrow(NotAuthorizedException);

    expect(() => {
      return applyAIRunPrivacyFilter(
        { runType: AIRunType.CodeFix },
        apiKeyShapedProps,
      );
    }).toThrow(NotAuthorizedException);
  });
});

describe("getAIRunPrivacyRaw — the predicate itself", () => {
  /*
   * The structural assertions below only prove the clause is PRESENT. This one
   * pins what it actually says, so a mis-bound parameter (the wrong run type,
   * or somebody else's id) cannot pass as "the clause survived".
   */
  test("binds exactly CodeFix and the calling user, and ORs them on the aliased column", () => {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const raw: any = getAIRunPrivacyRaw({ userId: userId });

    const sql: string = raw._getSql("COLUMN");
    const parameters: Record<string, string> = raw._objectLiteralParameters;
    const values: Array<string> = Object.values(parameters);

    expect(values).toHaveLength(2);
    expect(values).toContain(AIRunType.CodeFix);
    expect(values).toContain(userId.toString());

    // `<column> = :runType OR "AIRun"."userId" = :callerId`
    expect(sql).toContain("COLUMN = :");
    expect(sql).toContain(`OR "AIRun"."userId" = :`);
  });

  test("uses fresh parameter names per call so two clauses cannot collide", () => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const first: any = getAIRunPrivacyRaw({ userId: userId });
    const second: any = getAIRunPrivacyRaw({ userId: userId });
    /* eslint-enable @typescript-eslint/no-explicit-any */

    expect(Object.keys(first._objectLiteralParameters)).not.toEqual(
      Object.keys(second._objectLiteralParameters),
    );
  });
});

describe("applyAIRunPrivacyFilter — the clause is forced, never read from the query", () => {
  /*
   * findOneById builds { _id } with no runType at all. A dispatch that keyed
   * off the caller's runType would leave this query unfiltered (or pin it to
   * the user and break every code-fix detail page).
   */
  test("applies to a query with no runType at all (get-item)", () => {
    expectPrivacyClauseSurvives(serialize({ _id: ObjectID.generate() }));
  });

  test("a plain CodeFix filter is ANDed onto the clause, not trusted in place of it", () => {
    expectPrivacyClauseSurvives(serialize({ runType: AIRunType.CodeFix }));
  });

  test("leaves other query keys untouched", () => {
    const projectId: ObjectID = ObjectID.generate();
    const serialized: Record<string, unknown> = serialize({
      projectId: projectId,
      runType: AIRunType.CodeFix,
    });

    expect(serialized["projectId"]).toBeDefined();
  });
});

describe("applyAIRunPrivacyFilter — hostile operator smuggling", () => {
  /*
   * Each of these reads as "CodeFix" to a naive check but compiles to a
   * predicate that matches Chat rows, or erases the runType predicate
   * altogether. The clause must survive all of them.
   */
  const hostileValues: Array<[string, unknown]> = [
    [
      "NotEqual(CodeFix) inverts the predicate",
      new NotEqual(AIRunType.CodeFix),
    ],
    [
      "LessThan(CodeFix) escapes lexicographically ('Chat' < 'CodeFix')",
      new LessThan(AIRunType.CodeFix),
    ],
    [
      "NotContains(CodeFix) negates an ILIKE",
      new NotContains(AIRunType.CodeFix),
    ],
    ["Search(CodeFix)", new Search(AIRunType.CodeFix)],
    ["EqualToOrNull(CodeFix)", new EqualToOrNull(AIRunType.CodeFix)],
    ["IsNull()", new IsNull()],
    ["NotNull()", new NotNull()],
    ["a bare Chat string", AIRunType.Chat],
    ["a bare array of Chat", [AIRunType.Chat]],
    [
      "Includes([CodeFix, Chat]) — the shape ModelTable's own dropdown emits",
      new Includes([AIRunType.CodeFix, AIRunType.Chat]),
    ],
  ];

  test.each(hostileValues)(
    "privacy clause survives %s",
    (_name: string, value: unknown) => {
      expectPrivacyClauseSurvives(serialize({ runType: value as AIRunType }));
    },
  );

  /*
   * The sharpest one. MultiSearch stringifies to exactly "CodeFix", and
   * serializeQuery DELETES a MultiSearch key outright when its field list is
   * empty — substituting nothing. combineWithPrivacyClause has to fail closed
   * on this unrecognized shape so the forced clause is what remains.
   */
  test("MultiSearch with an empty field list cannot delete the clause", () => {
    const multiSearch: MultiSearch = new MultiSearch({
      value: AIRunType.CodeFix,
      fields: [],
    });

    // It reads as CodeFix to anything that normalizes via toString().
    expect(multiSearch.toString()).toBe(AIRunType.CodeFix);

    expectPrivacyClauseSurvives(
      serialize({ runType: multiSearch as unknown as AIRunType }),
    );
  });

  /*
   * A legitimate dropdown filter must still NARROW the result, not be thrown
   * away — otherwise "show me only regression tests" would silently return
   * everything. Includes is the one client shape combineWithPrivacyClause
   * keeps (as QueryHelper.any) rather than failing closed on.
   */
  test("Includes([CodeFix]) still narrows: both the IN and the clause survive", () => {
    const serialized: Record<string, unknown> = serialize({
      runType: new Includes([AIRunType.CodeFix]) as unknown as AIRunType,
    });

    const rendered: string = render(serialized["runType"]);

    expect(rendered).toContain(`"AIRun"."userId"`); // the forced clause
    expect(rendered.toLowerCase()).toContain("in"); // the caller's IN filter
  });

  /*
   * Negative control: proves the assertion can actually fail, so a green suite
   * means something. Without the filter the caller's operator stands alone.
   */
  test("control — an unfiltered query does NOT carry the clause", () => {
    const unfiltered: Record<string, unknown> = QueryUtil.serializeQuery(
      AIRun,
      { runType: new NotEqual(AIRunType.CodeFix) } as unknown as Query<AIRun>,
    ) as unknown as Record<string, unknown>;

    expect(render(unfiltered["runType"])).not.toContain(`"AIRun"."userId"`);
  });
});
