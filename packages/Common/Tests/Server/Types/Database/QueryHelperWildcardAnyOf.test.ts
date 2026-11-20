import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import QueryUtil from "../../../../Server/Types/Database/QueryUtil";
import TelemetryExceptionService from "../../../../Server/Services/TelemetryExceptionService";
import LogScrubRuleService from "../../../../Server/Services/LogScrubRuleService";
import TraceScrubRuleService from "../../../../Server/Services/TraceScrubRuleService";
import HashedAddressSearch from "../../../../Server/Utils/Telemetry/HashedAddressSearch";
import ScrubHashToken from "../../../../Server/Utils/Telemetry/ScrubHashToken";
import FindBy from "../../../../Server/Types/Database/FindBy";
import { OnFind } from "../../../../Server/Types/Database/Hooks";
import NotWildcard from "../../../../Types/BaseDatabase/NotWildcard";
import Search from "../../../../Types/BaseDatabase/Search";
import Wildcard from "../../../../Types/BaseDatabase/Wildcard";
import { MAX_WILDCARD_PATTERNS } from "../../../../Types/BaseDatabase/WildcardPattern";
import BadDataException from "../../../../Types/Exception/BadDataException";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import Query from "../../../../Types/BaseDatabase/Query";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A WILDCARD OF SEVERAL GLOBS ON A POSTGRES COLUMN IS ANY OF THEM.
 *
 * The search grammar compiles `(a* OR b*)` to one Wildcard of two globs, and
 * a search for an IP address in a project that hashes them compiles a
 * contains-match to the text or its hashed form (HashedAddressSearch,
 * #10418). ClickHouse read such a Wildcard as an OR of ILIKEs; Postgres read
 * it through its toString(), "(a* OR b*)", as ONE pattern that matched
 * nothing. Now Postgres ORs the globs too (QueryHelper.wildcardAny), and
 * ANDs their negation (notWildcardAny), letting NULL through as notWildcard
 * does. One glob reads exactly as it did.
 *
 * The exceptions list is a Postgres read (TelemetryException): its message
 * search, bound to the project's token for an address, comes out as two
 * ILIKEs.
 * ---------------------------------------------------------------------------
 */

interface RawOperator {
  objectLiteralParameters: Record<string, unknown>;
  getSql: (aliasPath: string) => string;
}

const asRaw: (operator: unknown) => RawOperator = (
  operator: unknown,
): RawOperator => {
  return operator as RawOperator;
};

const ALIAS: string = '"Monitor"."name"';

// The SQL with each bound name read as its value, so a test can read it whole.
const rendered: (operator: RawOperator) => string = (
  operator: RawOperator,
): string => {
  let sql: string = operator.getSql(ALIAS);

  for (const [name, value] of Object.entries(
    operator.objectLiteralParameters,
  )) {
    sql = sql.split(`:${name}`).join(`'${String(value)}'`);
  }

  return sql;
};

afterEach(() => {
  jest.restoreAllMocks();
  HashedAddressSearch.clearCache();
});

describe("QueryHelper.wildcardAny", () => {
  it("matches any of the globs: one ILIKE each, OR-ed in brackets", () => {
    expect(
      rendered(asRaw(QueryHelper.wildcardAny(["api-*", "*.internal"]))),
    ).toBe(
      `(CAST(${ALIAS} AS TEXT) ILIKE 'api-%' OR CAST(${ALIAS} AS TEXT) ILIKE '%.internal')`,
    );
  });

  it("binds each pattern under a name of its own, never into the SQL", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.wildcardAny(["'; DROP TABLE monitor; --*", "b*"]),
    );

    expect(operator.getSql(ALIAS)).not.toContain("DROP TABLE");
    expect(Object.values(operator.objectLiteralParameters)).toEqual([
      "'; DROP TABLE monitor; --%",
      "b%",
    ]);
  });

  it("escapes what the person typed, as one glob does", () => {
    expect(
      Object.values(
        asRaw(QueryHelper.wildcardAny(["100%*", "a_b?"]))
          .objectLiteralParameters,
      ),
    ).toEqual(["100\\%%", "a\\_b_"]);
  });

  it("one glob reads exactly as wildcard does", () => {
    expect(rendered(asRaw(QueryHelper.wildcardAny(["api-*"])))).toBe(
      rendered(asRaw(QueryHelper.wildcard("api-*"))),
    );
  });

  it("refuses more globs than one filter may carry", () => {
    const globs: Array<string> = Array.from(
      { length: MAX_WILDCARD_PATTERNS + 1 },
      (_value: unknown, index: number): string => {
        return `g${index}*`;
      },
    );

    expect(() => {
      QueryHelper.wildcardAny(globs);
    }).toThrow(BadDataException);
  });
});

describe("QueryHelper.notWildcardAny", () => {
  it("matches none of the globs, and lets a row with no value through", () => {
    expect(
      rendered(asRaw(QueryHelper.notWildcardAny(["api-*", "*.internal"]))),
    ).toBe(
      `((CAST(${ALIAS} AS TEXT) NOT ILIKE 'api-%' AND CAST(${ALIAS} AS TEXT) NOT ILIKE '%.internal') OR ${ALIAS} IS NULL)`,
    );
  });

  it("one glob reads exactly as notWildcard does", () => {
    expect(rendered(asRaw(QueryHelper.notWildcardAny(["api-*"])))).toBe(
      rendered(asRaw(QueryHelper.notWildcard("api-*"))),
    );
  });
});

describe("QueryUtil.serializeQuery reads a Wildcard of several globs as any of them", () => {
  it("not as the one pattern its toString() spells", () => {
    const query: Query<Monitor> = QueryUtil.serializeQuery<Monitor>(Monitor, {
      name: new Wildcard(["api-*", "web-*"]),
    } as Query<Monitor>);

    expect(rendered(asRaw(query["name"]))).toBe(
      `(CAST(${ALIAS} AS TEXT) ILIKE 'api-%' OR CAST(${ALIAS} AS TEXT) ILIKE 'web-%')`,
    );
  });

  it("its negation as none of them", () => {
    const query: Query<Monitor> = QueryUtil.serializeQuery<Monitor>(Monitor, {
      name: new NotWildcard(["api-*", "web-*"]),
    } as Query<Monitor>);

    expect(rendered(asRaw(query["name"]))).toContain(" AND ");
    expect(rendered(asRaw(query["name"]))).toContain("IS NULL");
  });

  it("one glob as it always read", () => {
    const query: Query<Monitor> = QueryUtil.serializeQuery<Monitor>(Monitor, {
      name: new Wildcard("api-*"),
    } as Query<Monitor>);

    expect(rendered(asRaw(query["name"]))).toBe(
      `(CAST(${ALIAS} AS TEXT) ILIKE 'api-%')`,
    );
  });
});

describe("the exceptions list: a message search for an address matches its token (#10418)", () => {
  const PROJECT: ObjectID = new ObjectID(
    "0193b0a1-0000-7000-8000-0000000e1041",
  );
  const ADDRESS: string = "203.0.113.7";
  const TOKEN: string = ScrubHashToken.ofIpAddress({
    projectId: PROJECT,
    address: ADDRESS,
  });

  const mockRules: (isHashing: boolean) => void = (
    isHashing: boolean,
  ): void => {
    jest
      .spyOn(LogScrubRuleService, "countBy")
      .mockResolvedValue(new PositiveNumber(isHashing ? 1 : 0) as never);
    jest
      .spyOn(TraceScrubRuleService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);
  };

  // The list's find hook, its scope and merged-exception reads left as they are.
  const listQueryOf: (
    query: Query<TelemetryException>,
  ) => Promise<Query<TelemetryException>> = async (
    query: Query<TelemetryException>,
  ): Promise<Query<TelemetryException>> => {
    jest
      .spyOn(TelemetryExceptionService, "addExceptionScope")
      .mockImplementation((async (scoped: unknown) => {
        return scoped;
      }) as never);
    jest
      .spyOn(TelemetryExceptionService, "withMergedFingerprintAliases")
      .mockImplementation((async (aliased: unknown) => {
        return aliased;
      }) as never);

    const onFind: OnFind<TelemetryException> = await (
      TelemetryExceptionService as unknown as {
        onBeforeFind: (
          findBy: FindBy<TelemetryException>,
        ) => Promise<OnFind<TelemetryException>>;
      }
    ).onBeforeFind({
      query,
      select: { message: true },
      limit: 10,
      skip: 0,
      props: { tenantId: PROJECT },
    });

    return onFind.findBy.query;
  };

  it("in a project that hashes IP addresses, as two ILIKEs: the text and its hashed form", async () => {
    mockRules(true);

    const query: Query<TelemetryException> = await listQueryOf({
      message: new Search(`connect ${ADDRESS} refused`),
    });

    expect(query.message).toEqual(
      new Wildcard([
        `*connect ${ADDRESS} refused*`,
        `*connect ${TOKEN} refused*`,
      ]),
    );

    const serialized: Query<TelemetryException> =
      QueryUtil.serializeQuery<TelemetryException>(TelemetryException, query);

    expect(
      Object.values(asRaw(serialized.message).objectLiteralParameters),
    ).toEqual([`%connect ${ADDRESS} refused%`, `%connect ${TOKEN} refused%`]);
  });

  it("in a project that does not, as it always read", async () => {
    mockRules(false);

    const query: Query<TelemetryException> = await listQueryOf({
      message: new Search(`connect ${ADDRESS} refused`),
    });

    expect(query.message).toEqual(new Search(`connect ${ADDRESS} refused`));
  });
});
