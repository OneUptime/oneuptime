import "../../../TestingUtils/Init";
import SecurityEvent from "../../../../../Models/AnalyticsModels/SecurityEvent";
import { ClickhouseAppInstance } from "../../../../../Server/Infrastructure/ClickhouseDatabase";
import { Statement } from "../../../../../Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator, {
  WATCHLIST_NOT_READ_MESSAGE,
} from "../../../../../Server/Utils/AnalyticsDatabase/StatementGenerator";
import CallerPermission from "../../../../../Server/Utils/Permission/CallerPermission";
import SecurityWatchlistQueryBinder, {
  MAX_WATCHLIST_SEARCH_PARAMETER_BYTES,
  SecurityWatchlistCondition,
} from "../../../../../Server/Utils/SecurityEvent/Watchlists/SecurityWatchlistQueryBinder";
import SecurityWatchlists, {
  SecurityWatchlistMissingException,
} from "../../../../../Server/Utils/SecurityEvent/Watchlists/SecurityWatchlists";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../../../Types/BaseDatabase/Includes";
import NotOnWatchlist from "../../../../../Types/BaseDatabase/NotOnWatchlist";
import OnWatchlist from "../../../../../Types/BaseDatabase/OnWatchlist";
import Search from "../../../../../Types/BaseDatabase/Search";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import { ObjectType } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { SecurityEntityType } from "../../../../../Types/SecurityCase/SecurityEntity";
import {
  SigmaWatchlist,
  getMissingSecurityWatchlistsMessage,
} from "../../../../../Types/SecurityEvent/SecurityWatchlist";
import { getJestSpyOn } from "../../../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A SEARCH, A MONITOR OR A HUNT THAT READS A WATCHLIST, AS A READ OF THE
 * SECURITYEVENT TABLE (#5391): the list's name in the query, read just
 * before the read is compiled and put in its place as a condition that
 * matches the list as a rule's read does - on a field of text, on any
 * element of an array, on a source attribute - for a caller who may read
 * the project's watchlists, in the caller's own project. A name read
 * nowhere is never compiled into nothing.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "12121212-1212-4212-8212-121212121212",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "34343434-3434-4434-8434-343434343434",
);
const USER_ID: ObjectID = new ObjectID("56565656-5656-4656-8656-565656565656");

function watchlist(overrides: Partial<SigmaWatchlist>): SigmaWatchlist {
  return {
    name: "vip_users",
    entityType: SecurityEntityType.User,
    exactValues: ["alice"],
    patterns: [],
    ranges: [],
    ...overrides,
  };
}

const VIP: SigmaWatchlist = watchlist({});
const ADMINS: SigmaWatchlist = watchlist({
  name: "Admin_Addresses",
  entityType: SecurityEntityType.IpAddress,
  exactValues: ["203.0.113.7"],
  ranges: ["10.20.0.0/16"],
});

function loaded(...lists: Array<SigmaWatchlist>): Map<string, SigmaWatchlist> {
  return new Map(
    lists.map((list: SigmaWatchlist): [string, SigmaWatchlist] => {
      return [list.name.toLowerCase(), list];
    }),
  );
}

function stubLoad(...lists: Array<SigmaWatchlist>): Spy {
  return getJestSpyOn(SecurityWatchlists, "load").mockResolvedValue(
    loaded(...lists) as never,
  );
}

function generator(): StatementGenerator<SecurityEvent> {
  return new StatementGenerator<SecurityEvent>({
    modelType: SecurityEvent,
    database: ClickhouseAppInstance,
  });
}

const PERSON: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: USER_ID,
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a list's name nothing has read", () => {
  test("is refused on a field, rather than compiled into nothing", () => {
    for (const operator of [
      new OnWatchlist("vip_users"),
      new NotOnWatchlist("vip_users"),
    ]) {
      expect(() => {
        generator().toWhereStatement({
          principalUser: operator,
        } as never);
      }).toThrow(new BadDataException(WATCHLIST_NOT_READ_MESSAGE));
    }
  });

  test("is refused on a source attribute too", () => {
    expect(() => {
      generator().toWhereStatement({
        attributes: { "src.user": new OnWatchlist("vip_users") },
      } as never);
    }).toThrow(WATCHLIST_NOT_READ_MESSAGE);
  });
});

describe("a list read and in place", () => {
  test("on a field of text: the list's match on the column, every value bound", () => {
    const statement: Statement = generator().toWhereStatement({
      principalUser: new SecurityWatchlistCondition(VIP, false),
    } as never);

    expect(statement.query).toBe(
      "AND (lowerUTF8({p0:Identifier}) IN {p1:Array(String)})",
    );
    expect(Object.values(statement.query_params)).toEqual([
      "principalUser",
      ["alice"],
    ]);
  });

  test("not on the list: the same match, negated", () => {
    const statement: Statement = generator().toWhereStatement({
      principalUser: new SecurityWatchlistCondition(VIP, true),
    } as never);

    expect(statement.query).toBe(
      "AND NOT (lowerUTF8({p0:Identifier}) IN {p1:Array(String)})",
    );
  });

  test("on an array column: any of its elements on the list", () => {
    const statement: Statement = generator().toWhereStatement({
      observables: new SecurityWatchlistCondition(VIP, false),
    } as never);

    expect(statement.query).toBe(
      "AND (arrayExists(__watchlist_element -> lowerUTF8(__watchlist_element) IN {p0:Array(String)}, {p1:Identifier}))",
    );
    expect(Object.values(statement.query_params)).toEqual([
      ["alice"],
      "observables",
    ]);
  });

  test("on a source attribute: the attribute's value, its key bound", () => {
    const statement: Statement = generator().toWhereStatement({
      attributes: { "src.ip": new SecurityWatchlistCondition(ADMINS, false) },
    } as never);

    expect(statement.query).toMatch(
      /^AND \(.*\{p0:Identifier\}\[\{p1:String\}\].*\)$/,
    );
    expect(statement.query_params["p0"]).toBe("attributes");
    expect(statement.query_params["p1"]).toBe("src.ip");
    expect(Object.values(statement.query_params)).toContainEqual([
      "203.0.113.7",
    ]);
  });

  test("beside the read's other filters, each on its own", () => {
    const statement: Statement = generator().toWhereStatement({
      projectId: PROJECT_ID,
      severityName: new Includes(["High"]),
      principalUser: new SecurityWatchlistCondition(VIP, false),
    } as never);

    expect(statement.query.split("AND ").length - 1).toBe(3);
  });

  test("a field of anything but text refuses a list", () => {
    expect(() => {
      generator().toWhereStatement({
        targetPort: new SecurityWatchlistCondition(VIP, false),
      } as never);
    }).toThrow(
      "A watchlist is matched against a field of text, and targetPort is not one.",
    );
  });

  test("written back as JSON, a condition is the name the query said", () => {
    expect(new SecurityWatchlistCondition(VIP, false).toJSON()).toEqual({
      _type: ObjectType.OnWatchlist,
      value: "vip_users",
    });
    expect(new SecurityWatchlistCondition(VIP, true).toJSON()).toEqual({
      _type: ObjectType.NotOnWatchlist,
      value: "vip_users",
    });
  });
});

describe("SecurityWatchlistQueryBinder.bind", () => {
  test("a query that reads no list is handed back as it is, with nothing read", async () => {
    const load: Spy = stubLoad();
    const query: Record<string, unknown> = {
      projectId: PROJECT_ID,
      message: new Search("failed"),
    };

    expect(SecurityWatchlistQueryBinder.readsWatchlists(query)).toBe(false);
    await expect(
      SecurityWatchlistQueryBinder.bind({ query, props: PERSON }),
    ).resolves.toBe(query);
    expect(load).not.toHaveBeenCalled();
  });

  test("each list the query names, read once in the caller's project, in its place on a new query", async () => {
    getJestSpyOn(CallerPermission, "holdsModelPermission").mockReturnValue(
      true as never,
    );
    const load: Spy = stubLoad(VIP, ADMINS);
    const query: Record<string, unknown> = {
      projectId: PROJECT_ID,
      principalUser: [new OnWatchlist("VIP_USERS"), new Search("a")],
      principalIp: new NotOnWatchlist("admin_addresses"),
      attributes: {
        env: "prod",
        "src.user": new OnWatchlist("vip_users"),
      },
    };

    expect(SecurityWatchlistQueryBinder.readsWatchlists(query)).toBe(true);

    const bound: Record<string, unknown> =
      await SecurityWatchlistQueryBinder.bind({ query, props: PERSON });

    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      names: ["VIP_USERS", "admin_addresses"],
    });

    const [onList, search] = bound["principalUser"] as Array<unknown>;

    expect(onList).toBeInstanceOf(SecurityWatchlistCondition);
    expect((onList as SecurityWatchlistCondition).watchlist).toBe(VIP);
    expect((onList as SecurityWatchlistCondition).isNegated).toBe(false);
    expect(search).toEqual(new Search("a"));
    expect((bound["principalIp"] as SecurityWatchlistCondition).isNegated).toBe(
      true,
    );
    expect((bound["principalIp"] as SecurityWatchlistCondition).watchlist).toBe(
      ADMINS,
    );
    expect((bound["attributes"] as Record<string, unknown>)["env"]).toBe(
      "prod",
    );
    expect(
      (bound["attributes"] as Record<string, unknown>)["src.user"],
    ).toBeInstanceOf(SecurityWatchlistCondition);

    // The query it was given is left as it was.
    expect(query["principalIp"]).toBeInstanceOf(NotOnWatchlist);
    expect(
      (query["attributes"] as Record<string, unknown>)["src.user"],
    ).toBeInstanceOf(OnWatchlist);
  });

  test("a person reads lists in their own project, whatever project the query names", async () => {
    getJestSpyOn(CallerPermission, "holdsModelPermission").mockReturnValue(
      true as never,
    );
    const load: Spy = stubLoad(VIP);

    await SecurityWatchlistQueryBinder.bind({
      query: {
        projectId: OTHER_PROJECT_ID,
        principalUser: new OnWatchlist("vip_users"),
      },
      props: PERSON,
    });

    expect((load.mock.calls[0]![0] as { projectId: ObjectID }).projectId).toBe(
      PROJECT_ID,
    );
  });

  test("OneUptime's own read - a monitor's run - reads the lists of the project its query names", async () => {
    const load: Spy = stubLoad(VIP);

    await SecurityWatchlistQueryBinder.bind({
      query: {
        projectId: PROJECT_ID.toString(),
        principalUser: new OnWatchlist("vip_users"),
      },
      props: { isRoot: true },
    });

    expect(
      (load.mock.calls[0]![0] as { projectId: ObjectID }).projectId.toString(),
    ).toBe(PROJECT_ID.toString());

    await expect(
      SecurityWatchlistQueryBinder.bind({
        query: { principalUser: new OnWatchlist("vip_users") },
        props: { isRoot: true },
      }),
    ).rejects.toThrow(
      "A read that matches a watchlist names the project the list is in.",
    );
  });

  test("a read outside a project reads no list", async () => {
    stubLoad(VIP);

    await expect(
      SecurityWatchlistQueryBinder.bind({
        query: { principalUser: new OnWatchlist("vip_users") },
        props: { userId: USER_ID },
      }),
    ).rejects.toThrow(
      "A watchlist is read in one project. Open the project first, then search.",
    );
  });

  test("a caller who may not read watchlists is refused, and no list is read", async () => {
    const holds: Spy = getJestSpyOn(
      CallerPermission,
      "holdsModelPermission",
    ).mockReturnValue(false as never);
    const load: Spy = stubLoad(VIP);

    await expect(
      SecurityWatchlistQueryBinder.bind({
        query: { principalUser: new OnWatchlist("vip_users") },
        props: PERSON,
      }),
    ).rejects.toThrow(NotAuthorizedException);
    expect(load).not.toHaveBeenCalled();
    expect(holds.mock.calls[0]![1]).toMatchObject({ operation: "read" });
    expect(holds.mock.calls[0]![2]).toEqual({ projectId: PROJECT_ID });
  });

  test("a name the project has no list of is refused in a rule's words", async () => {
    getJestSpyOn(CallerPermission, "holdsModelPermission").mockReturnValue(
      true as never,
    );
    stubLoad(VIP);

    const refusal: unknown = await SecurityWatchlistQueryBinder.bind({
      query: {
        principalUser: new OnWatchlist("vip_users"),
        principalHost: new OnWatchlist("crown_jewels"),
      },
      props: PERSON,
    }).catch((error: unknown) => {
      return error;
    });

    expect(refusal).toBeInstanceOf(SecurityWatchlistMissingException);
    expect((refusal as Error).message).toBe(
      getMissingSecurityWatchlistsMessage(["crown_jewels"]),
    );
  });

  test("lists too long to send in one read are refused, saying how much fits", async () => {
    getJestSpyOn(CallerPermission, "holdsModelPermission").mockReturnValue(
      true as never,
    );

    const values: Array<string> = [];

    for (let index: number = 0; index < 5000; index++) {
      values.push(`user-${index}-${"x".repeat(200)}@example.com`);
    }

    stubLoad(watchlist({ exactValues: values }));

    await expect(
      SecurityWatchlistQueryBinder.bind({
        query: { principalUser: new OnWatchlist("vip_users") },
        props: PERSON,
      }),
    ).rejects.toThrow(
      /^This search reads more watchlist values than one read can send to the database: about [\d,]+ KB, where [\d,]+ KB fit\./,
    );
    expect(MAX_WATCHLIST_SEARCH_PARAMETER_BYTES).toBeGreaterThan(0);
  });
});
