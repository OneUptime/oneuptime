import { mockRouter } from "Common/Tests/Server/API/Helpers";
import CommonAPI from "Common/Server/API/CommonAPI";
import Response from "Common/Server/Utils/Response";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import NetworkSiteService from "Common/Server/Services/NetworkSiteService";
import NetworkSiteLinkService from "Common/Server/Services/NetworkSiteLinkService";
import NetworkSiteStatusTimelineService from "Common/Server/Services/NetworkSiteStatusTimelineService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorStatusService from "Common/Server/Services/MonitorStatusService";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import NetworkSiteType from "Common/Models/DatabaseModels/NetworkSiteType";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import Color from "Common/Types/Color";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import UserType from "Common/Types/UserType";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * POST /network-site/search, end to end through the route handler.
 *
 * Issue #3981: the Device Topology explorer's search box only filtered the
 * hierarchy level on screen, so a unit four levels under a region could not
 * be found without opening every level above it first. The explorer now
 * shares the Network Map's search box, whose dropdown is fed by THIS
 * endpoint — so this is the half of the fix that actually reaches across the
 * hierarchy.
 *
 * The same change made the endpoint match every typed word, in any order,
 * rather than the whole string as one substring. "michigan 104822" used to
 * miss "Unit 104822 - Michigan Ave" here while the local filter beside it
 * found it, and the two halves of one search box disagreed about what
 * matched.
 *
 * The pure helpers (normalizeSearchText, splitSearchWords,
 * collectAncestorIds, buildParentBreadcrumbString, searchAllWords) have
 * their own unit tests. What is pinned here is the WIRING: what reaches
 * NetworkSiteService and MonitorStatusService, how many round trips a result
 * set costs, and exactly what the dropdown is handed back.
 */

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: jest.fn(),
    },
  };
});

jest.mock("Common/Server/API/CommonAPI", () => {
  return {
    __esModule: true,
    default: {
      getDatabaseCommonInteractionProps: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/NetworkSiteService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn(), findOneBy: jest.fn() },
  };
});

/*
 * The services below are imported by the API module for its other routes.
 * The search never calls them, but the real modules must not be loaded —
 * they would drag the database layer in with them — so each gets a stub.
 * Any of them being called by a search would be a bug, which is why the
 * last group of tests asserts that none of them ever is.
 */
jest.mock("Common/Server/Services/NetworkSiteLinkService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/NetworkSiteStatusTimelineService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/NetworkDeviceService", () => {
  return {
    __esModule: true,
    default: {
      getHealthGroupsForSites: jest.fn(),
      getHealthGroups: jest.fn(),
      countBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/MonitorService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/MonitorStatusService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

/*
 * Importing the API module registers its routes on the mocked router so the
 * handler can be invoked directly, with every service call observable.
 */
import NetworkSiteHierarchyAPI from "../../FeatureSet/BaseAPI/API/NetworkSiteHierarchy";

new NetworkSiteHierarchyAPI().getRouter();

const SEARCH_ROUTE: string = "/network-site/search";

// The endpoint's own cap on hits; see SEARCH_RESULT_LIMIT in the route.
const SEARCH_RESULT_LIMIT: number = 50;

// The word cap in NetworkSiteHierarchyUtil.MAX_SEARCH_WORDS.
const MAX_SEARCH_WORDS: number = 8;

const projectId: ObjectID = ObjectID.generate();

const commonAPI: { getDatabaseCommonInteractionProps: jest.Mock } =
  CommonAPI as unknown as { getDatabaseCommonInteractionProps: jest.Mock };
const siteService: { findBy: jest.Mock; findOneBy: jest.Mock } =
  NetworkSiteService as unknown as { findBy: jest.Mock; findOneBy: jest.Mock };
const monitorStatusService: { findBy: jest.Mock } =
  MonitorStatusService as unknown as { findBy: jest.Mock };
const responseUtil: { sendJsonObjectResponse: jest.Mock } =
  Response as unknown as { sendJsonObjectResponse: jest.Mock };
const userMiddleware: { getUserMiddleware: jest.Mock } =
  UserMiddleware as unknown as { getUserMiddleware: jest.Mock };

type UntouchedService = { name: string; stub: Record<string, jest.Mock> };

const UNTOUCHED_SERVICES: Array<UntouchedService> = [
  {
    name: "NetworkSiteLinkService",
    stub: NetworkSiteLinkService as unknown as Record<string, jest.Mock>,
  },
  {
    name: "NetworkSiteStatusTimelineService",
    stub: NetworkSiteStatusTimelineService as unknown as Record<
      string,
      jest.Mock
    >,
  },
  {
    name: "NetworkDeviceService",
    stub: NetworkDeviceService as unknown as Record<string, jest.Mock>,
  },
  {
    name: "MonitorService",
    stub: MonitorService as unknown as Record<string, jest.Mock>,
  },
];

const mockResponse: ExpressResponse = {} as ExpressResponse;

/*
 * A realistic set of permission props: a signed-in user, not root, with a
 * tenant. Built by a function so a test can compare the object the route was
 * handed against a fresh copy and prove the route never mutated it.
 */
function makeProps(userId: ObjectID): DatabaseCommonInteractionProps {
  return {
    tenantId: projectId,
    userId: userId,
    userType: UserType.User,
    isRoot: false,
    isMasterAdmin: false,
    isMultiTenantRequest: false,
  };
}

const userId: ObjectID = ObjectID.generate();

interface SearchCall {
  req: ExpressRequest;
  next: NextFunction;
}

type CallSearchFunction = (body: JSONObject | undefined) => Promise<SearchCall>;

const callSearch: CallSearchFunction = async (
  body: JSONObject | undefined,
): Promise<SearchCall> => {
  const next: NextFunction = jest.fn() as unknown as NextFunction;
  const req: ExpressRequest = { body: body } as unknown as ExpressRequest;
  await mockRouter
    .match("post", SEARCH_ROUTE)
    .handlerFunction(req, mockResponse, next);
  return { req: req, next: next };
};

interface SiteOptions {
  name?: string | undefined;
  // Root-first; the materialized path is built from these.
  ancestors?: Array<NetworkSite | ObjectID> | undefined;
  // Used verbatim when set — for paths the helpers would never build.
  materializedPath?: string | undefined;
  isUnitLevel?: boolean | undefined;
  typeName?: string | undefined;
  // A site whose NetworkSiteType row did not come back with it.
  withoutType?: boolean | undefined;
  legacySiteType?: string | undefined;
  statusId?: ObjectID | undefined;
}

function idOf(site: NetworkSite | ObjectID): string {
  return site instanceof ObjectID ? site.toString() : site.id!.toString();
}

function pathThrough(ancestors: Array<NetworkSite | ObjectID>): string {
  return `/${ancestors.map(idOf).join("/")}/`;
}

function makeSite(options: SiteOptions): NetworkSite {
  const site: NetworkSite = new NetworkSite(ObjectID.generate());
  if (options.name !== undefined) {
    site.name = options.name;
  }
  if (!options.withoutType) {
    const siteType: NetworkSiteType = new NetworkSiteType(ObjectID.generate());
    // Never "Unit": a type name a customer may rename must not drive logic.
    siteType.name =
      options.typeName || (options.isUnitLevel ? "Store" : "Region");
    siteType.isUnitLevel = Boolean(options.isUnitLevel);
    site.networkSiteType = siteType;
  }
  if (options.legacySiteType !== undefined) {
    site.siteType = options.legacySiteType;
  }
  if (options.materializedPath !== undefined) {
    site.materializedPath = options.materializedPath;
  } else if (options.ancestors && options.ancestors.length > 0) {
    site.materializedPath = pathThrough(options.ancestors);
  }
  if (options.statusId) {
    site.currentMonitorStatusId = options.statusId;
  }
  return site;
}

// A row as the ancestor lookup selects it: id and name, nothing else.
function ancestorRow(site: NetworkSite): NetworkSite {
  const row: NetworkSite = new NetworkSite(site.id!);
  if (site.name !== undefined) {
    row.name = site.name;
  }
  return row;
}

function makeStatus(options: {
  name?: string | undefined;
  color?: string | undefined;
  priority?: number | undefined;
  isOperationalState?: boolean | undefined;
  isOfflineState?: boolean | undefined;
}): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus(ObjectID.generate());
  if (options.name !== undefined) {
    status.name = options.name;
  }
  if (options.color !== undefined) {
    status.color = new Color(options.color);
  }
  if (options.priority !== undefined) {
    status.priority = options.priority;
  }
  if (options.isOperationalState !== undefined) {
    status.isOperationalState = options.isOperationalState;
  }
  if (options.isOfflineState !== undefined) {
    status.isOfflineState = options.isOfflineState;
  }
  return status;
}

/*
 * The endpoint asks NetworkSiteService for the matches first and, only when
 * a path needs names it does not already hold, for the ancestors second.
 */
function mockSiteQueries(
  matches: Array<NetworkSite>,
  ancestors?: Array<NetworkSite> | undefined,
): void {
  siteService.findBy.mockResolvedValueOnce(matches as never);
  if (ancestors) {
    siteService.findBy.mockResolvedValueOnce(ancestors as never);
  }
}

function lastResponseBody(): JSONObject {
  expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
  return responseUtil.sendJsonObjectResponse.mock.calls[0]![2] as JSONObject;
}

function responseResults(): Array<JSONObject> {
  return lastResponseBody()["results"] as Array<JSONObject>;
}

function resultNamed(name: string): JSONObject {
  const result: JSONObject | undefined = responseResults().find(
    (candidate: JSONObject): boolean => {
      return candidate["name"] === name;
    },
  );
  expect(result).toBeDefined();
  return result as JSONObject;
}

function findByArgs(callIndex: number): JSONObject {
  return siteService.findBy.mock.calls[callIndex]![0] as JSONObject;
}

function searchQuery(): JSONObject {
  return findByArgs(0)["query"] as JSONObject;
}

/*
 * QueryHelper.any() compiles to a TypeORM Raw operator whose object-literal
 * parameters carry the id list; this digs the list back out.
 */
function idsInAnyOperator(operator: unknown): Array<string> {
  const parameters: JSONObject = (operator as JSONObject)[
    "objectLiteralParameters"
  ] as JSONObject;
  return Object.values(parameters)[0] as Array<string>;
}

type RawOperator = {
  type: string;
  getSql: (alias: string) => string;
  objectLiteralParameters: Record<string, unknown>;
};

const NAME_ALIAS: string = '"NetworkSite"."name"';

function renderedSql(operator: unknown): string {
  return (operator as RawOperator).getSql(NAME_ALIAS);
}

/*
 * QueryHelper.searchAllWords() compiles to ONE Raw operator: an AND-joined
 * ILIKE per word, each bound to a random parameter name. The names are
 * random, so this walks the rendered SQL and resolves each placeholder to
 * its bound pattern — in the order the SQL uses them, which is the order
 * the words were typed in.
 */
function ilikePatterns(operator: unknown): Array<string> {
  const raw: RawOperator = operator as RawOperator;
  expect(raw.type).toBe("raw");
  const sql: string = renderedSql(operator);
  const escapedAlias: string = NAME_ALIAS.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const term: string = `CAST\\(${escapedAlias} AS TEXT\\) ILIKE :([A-Za-z]+)`;
  // The whole clause is parenthesized, so it cannot leak into an OR.
  expect(sql).toMatch(new RegExp(`^\\(${term}( AND ${term})*\\)$`));

  const parameters: Record<string, unknown> = raw.objectLiteralParameters;
  const placeholders: Array<string> = [];
  const pattern: RegExp = new RegExp(term, "g");
  let match: RegExpExecArray | null = pattern.exec(sql);
  while (match) {
    placeholders.push(match[1] as string);
    match = pattern.exec(sql);
  }

  // No placeholder bound twice, and no parameter left unused.
  expect(new Set<string>(placeholders).size).toBe(placeholders.length);
  expect(Object.keys(parameters).sort()).toEqual([...placeholders].sort());

  return placeholders.map((placeholder: string): string => {
    return parameters[placeholder] as string;
  });
}

function nameFilterPatterns(): Array<string> {
  return ilikePatterns(searchQuery()["name"]);
}

function resetServiceMocks(): void {
  jest.clearAllMocks();
  siteService.findBy.mockReset();
  siteService.findOneBy.mockReset();
  monitorStatusService.findBy.mockReset();
  commonAPI.getDatabaseCommonInteractionProps.mockReset();

  commonAPI.getDatabaseCommonInteractionProps.mockResolvedValue(
    makeProps(userId) as never,
  );
  siteService.findBy.mockResolvedValue([] as never);
  siteService.findOneBy.mockResolvedValue(null as never);
  monitorStatusService.findBy.mockResolvedValue([] as never);
}

/*
 * The route is authenticated like every other one in the module. A search
 * that leaked site names to an anonymous caller would be a data leak, so the
 * middleware is pinned rather than assumed.
 */
describe("POST /network-site/search — registration", () => {
  test("is registered as a POST behind the user middleware", () => {
    const route: {
      middlewares: Array<unknown>;
      handlerFunction: unknown;
    } = mockRouter.match("post", SEARCH_ROUTE);
    expect(route.middlewares).toEqual([userMiddleware.getUserMiddleware]);
    expect(typeof route.handlerFunction).toBe("function");
  });
});

/*
 * An empty box is not a query for every site in the project, and it is not
 * an error either — it is no results, answered without touching the
 * database at all. The dashboard fires this endpoint on every debounced
 * keystroke, so "the user cleared the box" is a hot path.
 */
describe("POST /network-site/search — nothing to search for", () => {
  beforeEach(() => {
    resetServiceMocks();
  });

  const blankInputs: Array<{ label: string; body: JSONObject | undefined }> = [
    { label: "an empty string", body: { searchText: "" } },
    { label: "spaces only", body: { searchText: "     " } },
    { label: "tabs and newlines only", body: { searchText: "\t\n \r\n" } },
    { label: "a missing searchText", body: {} },
    { label: "a null searchText", body: { searchText: null } },
    { label: "a numeric searchText", body: { searchText: 104822 } },
    { label: "a boolean searchText", body: { searchText: true } },
    { label: "an object searchText", body: { searchText: { name: "east" } } },
    { label: "an array searchText", body: { searchText: ["east", "west"] } },
    { label: "no body at all", body: undefined },
  ];

  for (const input of blankInputs) {
    test(`${input.label} answers with no results and no query`, async () => {
      const call: SearchCall = await callSearch(input.body);

      expect(call.next).not.toHaveBeenCalled();
      expect(lastResponseBody()).toEqual({ results: [], isTruncated: false });
      expect(siteService.findBy).not.toHaveBeenCalled();
      expect(monitorStatusService.findBy).not.toHaveBeenCalled();
    });
  }

  test("the empty answer is sent on the request and response it was given", async () => {
    const call: SearchCall = await callSearch({ searchText: "  " });

    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
    expect(responseUtil.sendJsonObjectResponse.mock.calls[0]![0]).toBe(
      call.req,
    );
    expect(responseUtil.sendJsonObjectResponse.mock.calls[0]![1]).toBe(
      mockResponse,
    );
  });
});

/*
 * Without a tenant there is no project to scope the query to, and an
 * unscoped name search would read every customer's sites. The request is
 * refused before anything else — including before the blank-box shortcut,
 * so a malformed request is never answered as if it were fine.
 */
describe("POST /network-site/search — project scope is required", () => {
  beforeEach(() => {
    resetServiceMocks();
  });

  test("a request with no tenant is handed to next() as BadDataException", async () => {
    commonAPI.getDatabaseCommonInteractionProps.mockResolvedValue({
      userId: userId,
    } as never);

    const call: SearchCall = await callSearch({ searchText: "michigan" });

    expect(call.next).toHaveBeenCalledTimes(1);
    const error: unknown = (call.next as unknown as jest.Mock).mock
      .calls[0]![0];
    expect(error).toBeInstanceOf(BadDataException);
    expect((error as BadDataException).message).toBe(
      "Project not found in request",
    );
    expect(siteService.findBy).not.toHaveBeenCalled();
    expect(monitorStatusService.findBy).not.toHaveBeenCalled();
    expect(responseUtil.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test("the tenant check runs before the blank-box shortcut", async () => {
    commonAPI.getDatabaseCommonInteractionProps.mockResolvedValue({} as never);

    const call: SearchCall = await callSearch({ searchText: "" });

    expect(call.next).toHaveBeenCalledTimes(1);
    expect(
      (call.next as unknown as jest.Mock).mock.calls[0]![0],
    ).toBeInstanceOf(BadDataException);
    expect(responseUtil.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test("the props are resolved from the incoming request", async () => {
    const call: SearchCall = await callSearch({ searchText: "east" });

    expect(commonAPI.getDatabaseCommonInteractionProps).toHaveBeenCalledTimes(
      1,
    );
    expect(commonAPI.getDatabaseCommonInteractionProps.mock.calls[0]![0]).toBe(
      call.req,
    );
  });
});

/*
 * The heart of the behaviour change. Every typed word must appear somewhere
 * in the name, in any order — one ILIKE per word, AND-joined — rather than
 * the whole string as one substring. The reporter's case is
 * "michigan 104822" against "Unit 104822 - Michigan Ave": the old single
 * pattern "%michigan 104822%" could never match it, while the local filter
 * on the level in view did.
 */
describe("POST /network-site/search — the name filter", () => {
  beforeEach(() => {
    resetServiceMocks();
  });

  test("two words with messy spacing become two AND-joined ILIKEs", async () => {
    await callSearch({ searchText: "  Michigan   104822 " });

    expect(siteService.findBy).toHaveBeenCalledTimes(1);
    const sql: string = renderedSql(searchQuery()["name"]);
    expect(sql.split(" AND ")).toHaveLength(2);
    expect(sql.match(/ILIKE/g)).toHaveLength(2);
    expect(nameFilterPatterns()).toEqual(["%michigan%", "%104822%"]);
  });

  /*
   * The regression the change exists to prevent: the multi-word string
   * must never reach the database as ONE pattern, or it only matches names
   * that happen to hold those words adjacent and in that order.
   */
  test("the typed string is never sent as a single substring", async () => {
    await callSearch({ searchText: "michigan 104822" });

    const patterns: Array<string> = nameFilterPatterns();
    expect(patterns).not.toContain("%michigan 104822%");
    for (const pattern of patterns) {
      expect(pattern).not.toMatch(/\s/);
    }
  });

  test("word order does not change which patterns are required", async () => {
    await callSearch({ searchText: "michigan 104822" });
    const forwards: Array<string> = nameFilterPatterns();

    resetServiceMocks();
    await callSearch({ searchText: "104822 michigan" });
    const backwards: Array<string> = nameFilterPatterns();

    expect([...forwards].sort()).toEqual([...backwards].sort());
  });

  test("a single word is one ILIKE, still parenthesized", async () => {
    await callSearch({ searchText: "Chicago" });

    expect(renderedSql(searchQuery()["name"])).toMatch(
      /^\(CAST\("NetworkSite"\."name" AS TEXT\) ILIKE :[A-Za-z]+\)$/,
    );
    expect(nameFilterPatterns()).toEqual(["%chicago%"]);
  });

  test("tabs and newlines separate words just like spaces do", async () => {
    await callSearch({ searchText: "Kansas\tCity\nStore" });

    expect(nameFilterPatterns()).toEqual(["%kansas%", "%city%", "%store%"]);
  });

  test("words are lower-cased before they reach the query", async () => {
    await callSearch({ searchText: "MICHIGAN Ave" });

    expect(nameFilterPatterns()).toEqual(["%michigan%", "%ave%"]);
  });

  /*
   * A repeated word is the same predicate twice. It narrows nothing and
   * would spend one of the eight word slots, so it is sent once — including
   * when the repeats differ only in case.
   */
  test("a repeated word, in any casing, is required only once", async () => {
    await callSearch({ searchText: "store Store STORE 12" });

    expect(nameFilterPatterns()).toEqual(["%store%", "%12%"]);
  });

  /*
   * A `%` or `_` somebody typed is a character they are looking for, not a
   * wildcard. Unescaped, "%" alone would match every site in the project and
   * "_" would match every name with at least one character.
   */
  test("LIKE metacharacters in a word are escaped, not treated as wildcards", async () => {
    await callSearch({ searchText: "100%_off back\\slash" });

    expect(nameFilterPatterns()).toEqual(["%100\\%\\_off%", "%back\\\\slash%"]);
  });

  test("a lone percent sign searches for a literal percent sign", async () => {
    await callSearch({ searchText: "%" });

    expect(nameFilterPatterns()).toEqual(["%\\%%"]);
  });

  test("a lone underscore searches for a literal underscore", async () => {
    await callSearch({ searchText: "_" });

    expect(nameFilterPatterns()).toEqual(["%\\_%"]);
  });

  /*
   * A caller-supplied value lands in a bound parameter, never in the SQL
   * text itself — the rendered clause carries only the column and the
   * placeholders.
   */
  test("the typed words are bound as parameters, not spliced into the SQL", async () => {
    await callSearch({ searchText: "o'brien'); drop table x; --" });

    const sql: string = renderedSql(searchQuery()["name"]);
    expect(sql).not.toContain("o'brien");
    expect(sql).not.toContain("drop");
    expect(nameFilterPatterns()).toEqual([
      "%o'brien');%",
      "%drop%",
      "%table%",
      "%x;%",
      "%--%",
    ]);
  });

  /*
   * Each word is its own ILIKE over the project's sites, so the count is
   * capped. The longest words are the ones kept: they narrow the match the
   * most, and dropping a word only ever widens the result — it can never
   * hide a site that matched every word.
   */
  test("more than eight words keeps only the eight longest", async () => {
    await callSearch({
      searchText:
        "a bb ccc dddd eeeee ffffff ggggggg hhhhhhhh iiiiiiiii jjjjjjjjjj",
    });

    const patterns: Array<string> = nameFilterPatterns();
    expect(patterns).toHaveLength(MAX_SEARCH_WORDS);
    expect(renderedSql(searchQuery()["name"]).match(/ILIKE/g)).toHaveLength(
      MAX_SEARCH_WORDS,
    );
    expect(patterns).toEqual([
      "%ccc%",
      "%dddd%",
      "%eeeee%",
      "%ffffff%",
      "%ggggggg%",
      "%hhhhhhhh%",
      "%iiiiiiiii%",
      "%jjjjjjjjjj%",
    ]);
  });

  test("the kept words stay in the order they were typed", async () => {
    await callSearch({
      searchText:
        "jjjjjjjjjj a iiiiiiiii bb hhhhhhhh ggggggg ffffff eeeee dddd ccc",
    });

    expect(nameFilterPatterns()).toEqual([
      "%jjjjjjjjjj%",
      "%iiiiiiiii%",
      "%hhhhhhhh%",
      "%ggggggg%",
      "%ffffff%",
      "%eeeee%",
      "%dddd%",
      "%ccc%",
    ]);
  });

  test("past the cap, words of equal length are kept first-come", async () => {
    await callSearch({
      searchText: "w01 w02 w03 w04 w05 w06 w07 w08 w09 w10",
    });

    expect(nameFilterPatterns()).toEqual([
      "%w01%",
      "%w02%",
      "%w03%",
      "%w04%",
      "%w05%",
      "%w06%",
      "%w07%",
      "%w08%",
    ]);
  });

  test("exactly eight words are all kept", async () => {
    await callSearch({ searchText: "a b c d e f g h" });

    expect(nameFilterPatterns()).toEqual([
      "%a%",
      "%b%",
      "%c%",
      "%d%",
      "%e%",
      "%f%",
      "%g%",
      "%h%",
    ]);
  });

  // Repeats are dropped BEFORE the cap, so they never cost a real word.
  test("repeated words do not count toward the eight-word cap", async () => {
    await callSearch({ searchText: "x x x x x x x x x x y" });

    expect(nameFilterPatterns()).toEqual(["%x%", "%y%"]);
  });

  /*
   * The text is capped at 200 characters before it is split, so a word
   * straddling the cap is cut rather than the request being refused.
   */
  test("the 200-character cap is applied before the words are split", async () => {
    const longWord: string = "a".repeat(196);
    await callSearch({ searchText: `${longWord} zebra` });

    expect(nameFilterPatterns()).toEqual([`%${longWord}%`, "%zeb%"]);
  });
});

/*
 * Everything about the match query other than the name filter: which
 * project it reads, under whose permissions, how much, in what order, and
 * which columns. Above all, what it does NOT filter on — a level. The whole
 * point of issue #3981 is that the search reaches every level of the
 * hierarchy, so a parentSiteId or materializedPath condition here would put
 * the bug straight back.
 */
describe("POST /network-site/search — the match query", () => {
  beforeEach(() => {
    resetServiceMocks();
  });

  test("filters on the project and the name, and nothing else", async () => {
    await callSearch({
      searchText: "store",
      // A client that still sends the level in view must not narrow the search.
      siteId: ObjectID.generate().toString(),
      parentSiteId: ObjectID.generate().toString(),
    });

    const query: JSONObject = searchQuery();
    expect(Object.keys(query).sort()).toEqual(["name", "projectId"]);
    expect((query["projectId"] as ObjectID).toString()).toBe(
      projectId.toString(),
    );
  });

  test("is capped at 50 hits, from the first, sorted by name ascending", async () => {
    await callSearch({ searchText: "store" });

    const args: JSONObject = findByArgs(0);
    expect(args["limit"]).toBe(SEARCH_RESULT_LIMIT);
    expect(args["skip"]).toBe(0);
    expect(args["sort"]).toEqual({ name: SortOrder.Ascending });
  });

  /*
   * Exactly the columns the dropdown prints, plus the path and status keys
   * it needs to resolve. The type's two columns are canReadOnRelationQuery,
   * so pulling them inline costs no extra permission and no extra query.
   */
  test("selects exactly the columns the response is built from", async () => {
    await callSearch({ searchText: "store" });

    expect(findByArgs(0)["select"]).toEqual({
      _id: true,
      name: true,
      siteType: true,
      networkSiteType: { name: true, isUnitLevel: true },
      materializedPath: true,
      currentMonitorStatusId: true,
    });
  });

  /*
   * The props carry the caller's permissions, and the permission layer is
   * what makes a user only find the sites they may read. The route must
   * hand over the very object it resolved — not a copy with fields dropped,
   * and not an elevated one — and must not alter it on the way.
   */
  test("runs under the caller's permission props, passed through unchanged", async () => {
    const props: DatabaseCommonInteractionProps = makeProps(userId);
    commonAPI.getDatabaseCommonInteractionProps.mockResolvedValue(
      props as never,
    );

    await callSearch({ searchText: "store" });

    expect(findByArgs(0)["props"]).toBe(props);
    expect(props).toEqual(makeProps(userId));
    expect(props.isRoot).toBe(false);
  });

  test("runs one query when nothing matches, and answers with no results", async () => {
    const call: SearchCall = await callSearch({ searchText: "nowhere" });

    expect(call.next).not.toHaveBeenCalled();
    expect(siteService.findBy).toHaveBeenCalledTimes(1);
    expect(monitorStatusService.findBy).not.toHaveBeenCalled();
    expect(lastResponseBody()).toEqual({ results: [], isTruncated: false });
  });
});

/*
 * What each hit looks like on the wire. The dropdown prints the name, the
 * type and the path, colours the row by status, and — for Device Topology —
 * uses isUnitLevel to decide whether picking it opens a device topology or
 * drills to a level. A wrong flag here sends the user to the wrong screen.
 */
describe("POST /network-site/search — the result rows", () => {
  beforeEach(() => {
    resetServiceMocks();
  });

  test("a hit carries its id, name, type, level flag, path and status", async () => {
    const region: NetworkSite = makeSite({ name: "Region East" });
    const status: MonitorStatus = makeStatus({
      name: "Operational",
      color: "#10b981",
      priority: 1,
      isOperationalState: true,
      isOfflineState: false,
    });
    const store: NetworkSite = makeSite({
      name: "Unit 104822 - Michigan Ave",
      isUnitLevel: true,
      ancestors: [region],
      statusId: status.id!,
    });

    mockSiteQueries([store], [ancestorRow(region)]);
    monitorStatusService.findBy.mockResolvedValue([status] as never);

    const call: SearchCall = await callSearch({
      searchText: "michigan 104822",
    });
    expect(call.next).not.toHaveBeenCalled();

    const body: JSONObject = lastResponseBody();
    expect(body["isTruncated"]).toBe(false);
    const results: Array<JSONObject> = body["results"] as Array<JSONObject>;
    expect(results).toHaveLength(1);
    expect(Object.keys(results[0]!).sort()).toEqual([
      "currentMonitorStatus",
      "id",
      "isUnitLevel",
      "name",
      "path",
      "siteType",
    ]);
    expect(results[0]).toEqual({
      id: store.id!.toString(),
      name: "Unit 104822 - Michigan Ave",
      siteType: "Store",
      isUnitLevel: true,
      path: "Region East",
      currentMonitorStatus: {
        id: status.id!.toString(),
        name: "Operational",
        color: "#10b981",
        priority: 1,
        isOperationalState: true,
        isOfflineState: false,
      },
    });
  });

  /*
   * The reporter's scenario, end to end: one search returns sites from
   * every level at once — a root, something in the middle, and a unit four
   * levels down — each with the path that tells the user where it is.
   */
  test("one search returns hits from every level of the hierarchy", async () => {
    const region: NetworkSite = makeSite({ name: "Region East" });
    const market: NetworkSite = makeSite({
      name: "Market North",
      ancestors: [region],
    });
    const district: NetworkSite = makeSite({
      name: "District 9",
      ancestors: [region, market],
    });
    const rootHit: NetworkSite = makeSite({ name: "Michigan Region" });
    const middleHit: NetworkSite = makeSite({
      name: "Michigan Market",
      ancestors: [region],
    });
    const unitHit: NetworkSite = makeSite({
      name: "Unit 104822 - Michigan Ave",
      isUnitLevel: true,
      ancestors: [region, market, district],
    });

    mockSiteQueries(
      [middleHit, rootHit, unitHit],
      [ancestorRow(region), ancestorRow(market), ancestorRow(district)],
    );

    await callSearch({ searchText: "michigan" });

    expect(
      responseResults().map((result: JSONObject): unknown => {
        return [result["name"], result["path"], result["isUnitLevel"]];
      }),
    ).toEqual([
      ["Michigan Market", "Region East", false],
      ["Michigan Region", "", false],
      [
        "Unit 104822 - Michigan Ave",
        "Region East / Market North / District 9",
        true,
      ],
    ]);
  });

  // The database sorted them by name; the route must not reshuffle them.
  test("hits come back in the order the query returned them", async () => {
    mockSiteQueries([
      makeSite({ name: "Store C" }),
      makeSite({ name: "Store A" }),
      makeSite({ name: "Store B" }),
    ]);

    await callSearch({ searchText: "store" });

    expect(
      responseResults().map((result: JSONObject): unknown => {
        return result["name"];
      }),
    ).toEqual(["Store C", "Store A", "Store B"]);
  });

  test("a row with no id is dropped", async () => {
    const ghost: NetworkSite = new NetworkSite();
    ghost.name = "Ghost Store";
    const real: NetworkSite = makeSite({ name: "Real Store" });
    mockSiteQueries([ghost, real]);

    await callSearch({ searchText: "store" });

    const results: Array<JSONObject> = responseResults();
    expect(results).toHaveLength(1);
    expect(results[0]!["name"]).toBe("Real Store");
    expect(results[0]!["id"]).toBe(real.id!.toString());
  });

  test("a hit with no name is labelled 'Unnamed site'", async () => {
    const nameless: NetworkSite = makeSite({});
    const blankName: NetworkSite = makeSite({ name: "" });
    mockSiteQueries([nameless, blankName]);

    await callSearch({ searchText: "store" });

    expect(
      responseResults().map((result: JSONObject): unknown => {
        return [result["id"], result["name"]];
      }),
    ).toEqual([
      [nameless.id!.toString(), "Unnamed site"],
      [blankName.id!.toString(), "Unnamed site"],
    ]);
  });

  /*
   * The type label and the level flag come from the per-project
   * NetworkSiteType row. The label falls back to the legacy inline column
   * and then to "Other"; the flag has no fallback at all, because inferring
   * "leaf level" from a type's NAME is exactly the logic that row replaced.
   */
  test("siteType and isUnitLevel come from the site's type row", async () => {
    mockSiteQueries([
      makeSite({ name: "Store 1", isUnitLevel: true, typeName: "Store" }),
      makeSite({ name: "Region 1", isUnitLevel: false, typeName: "Region" }),
    ]);

    await callSearch({ searchText: "1" });

    expect(resultNamed("Store 1")["siteType"]).toBe("Store");
    expect(resultNamed("Store 1")["isUnitLevel"]).toBe(true);
    expect(resultNamed("Region 1")["siteType"]).toBe("Region");
    expect(resultNamed("Region 1")["isUnitLevel"]).toBe(false);
  });

  test("a type NAMED 'Unit' is not the unit level unless it is flagged so", async () => {
    mockSiteQueries([
      makeSite({ name: "Unit 7", isUnitLevel: false, typeName: "Unit" }),
    ]);

    await callSearch({ searchText: "unit" });

    expect(resultNamed("Unit 7")["siteType"]).toBe("Unit");
    expect(resultNamed("Unit 7")["isUnitLevel"]).toBe(false);
  });

  test("with no type row the legacy siteType labels it, and it is not a unit", async () => {
    mockSiteQueries([
      makeSite({
        name: "Legacy Store",
        withoutType: true,
        legacySiteType: "Store",
      }),
    ]);

    await callSearch({ searchText: "legacy" });

    expect(resultNamed("Legacy Store")["siteType"]).toBe("Store");
    expect(resultNamed("Legacy Store")["isUnitLevel"]).toBe(false);
  });

  test("with neither a type row nor a legacy type it is labelled 'Other'", async () => {
    mockSiteQueries([makeSite({ name: "Mystery Site", withoutType: true })]);

    await callSearch({ searchText: "mystery" });

    expect(resultNamed("Mystery Site")["siteType"]).toBe("Other");
    expect(resultNamed("Mystery Site")["isUnitLevel"]).toBe(false);
  });

  /*
   * The dropdown needs the path, never the raw materialized path of ids:
   * those are internal, and nothing on the client could print them.
   */
  test("the materialized path itself is not sent to the client", async () => {
    const region: NetworkSite = makeSite({ name: "Region East" });
    mockSiteQueries(
      [makeSite({ name: "Store 1", ancestors: [region] })],
      [ancestorRow(region)],
    );

    await callSearch({ searchText: "store" });

    const result: JSONObject = resultNamed("Store 1");
    expect(result["materializedPath"]).toBeUndefined();
    expect(result["path"]).toBe("Region East");
  });
});

/*
 * Each hit prints the path to it, which is what tells two similarly named
 * stores apart before the click. Resolving those names must cost ONE extra
 * query for the whole result set — never a walk per hit — and no query at
 * all when every name is already in hand.
 */
describe("POST /network-site/search — paths", () => {
  beforeEach(() => {
    resetServiceMocks();
  });

  test("a root site has an empty path and costs no ancestor query", async () => {
    mockSiteQueries([
      makeSite({ name: "Region East" }),
      makeSite({ name: "Region West", materializedPath: "/" }),
    ]);

    await callSearch({ searchText: "region" });

    expect(siteService.findBy).toHaveBeenCalledTimes(1);
    expect(resultNamed("Region East")["path"]).toBe("");
    expect(resultNamed("Region West")["path"]).toBe("");
  });

  test("the path is the ancestors' names, root first, joined by ' / '", async () => {
    const region: NetworkSite = makeSite({ name: "Region East" });
    const market: NetworkSite = makeSite({
      name: "Market North",
      ancestors: [region],
    });
    const district: NetworkSite = makeSite({
      name: "District 9",
      ancestors: [region, market],
    });
    const store: NetworkSite = makeSite({
      name: "Store 12",
      isUnitLevel: true,
      ancestors: [region, market, district],
    });

    // Ancestor rows arrive in no useful order; the PATH decides the order.
    mockSiteQueries(
      [store],
      [ancestorRow(district), ancestorRow(region), ancestorRow(market)],
    );

    await callSearch({ searchText: "store" });

    expect(resultNamed("Store 12")["path"]).toBe(
      "Region East / Market North / District 9",
    );
  });

  test("the ancestor query is scoped, permissioned, and asks only for names", async () => {
    const props: DatabaseCommonInteractionProps = makeProps(userId);
    commonAPI.getDatabaseCommonInteractionProps.mockResolvedValue(
      props as never,
    );
    const region: NetworkSite = makeSite({ name: "Region East" });
    const market: NetworkSite = makeSite({
      name: "Market North",
      ancestors: [region],
    });
    mockSiteQueries(
      [makeSite({ name: "Store 1", ancestors: [region, market] })],
      [ancestorRow(region), ancestorRow(market)],
    );

    await callSearch({ searchText: "store" });

    expect(siteService.findBy).toHaveBeenCalledTimes(2);
    const args: JSONObject = findByArgs(1);
    const query: JSONObject = args["query"] as JSONObject;
    expect(Object.keys(query).sort()).toEqual(["_id", "projectId"]);
    expect((query["projectId"] as ObjectID).toString()).toBe(
      projectId.toString(),
    );
    expect(idsInAnyOperator(query["_id"])).toEqual([
      region.id!.toString(),
      market.id!.toString(),
    ]);
    expect(args["select"]).toEqual({ _id: true, name: true });
    expect(args["limit"]).toBe(LIMIT_PER_PROJECT);
    expect(args["skip"]).toBe(0);
    /*
     * The same props as the match query: an ancestor the caller cannot
     * read must not have its name printed in somebody's path.
     */
    expect(args["props"]).toBe(props);
  });

  test("hits that share ancestors resolve them in one query, each id once", async () => {
    const region: NetworkSite = makeSite({ name: "Region East" });
    const market: NetworkSite = makeSite({
      name: "Market North",
      ancestors: [region],
    });
    const otherMarket: NetworkSite = makeSite({
      name: "Market South",
      ancestors: [region],
    });
    const hits: Array<NetworkSite> = [
      makeSite({ name: "Store 1", ancestors: [region, market] }),
      makeSite({ name: "Store 2", ancestors: [region, market] }),
      makeSite({ name: "Store 3", ancestors: [region, otherMarket] }),
    ];
    mockSiteQueries(hits, [
      ancestorRow(region),
      ancestorRow(market),
      ancestorRow(otherMarket),
    ]);

    await callSearch({ searchText: "store" });

    expect(siteService.findBy).toHaveBeenCalledTimes(2);
    expect(
      idsInAnyOperator((findByArgs(1)["query"] as JSONObject)["_id"]).sort(),
    ).toEqual(
      [
        region.id!.toString(),
        market.id!.toString(),
        otherMarket.id!.toString(),
      ].sort(),
    );
    expect(resultNamed("Store 1")["path"]).toBe("Region East / Market North");
    expect(resultNamed("Store 2")["path"]).toBe("Region East / Market North");
    expect(resultNamed("Store 3")["path"]).toBe("Region East / Market South");
  });

  /*
   * "east" matches both a region and the stores beneath it. The region's
   * name came back with the search itself, so fetching it again would be a
   * second query for data already in hand.
   */
  test("no ancestor query when every ancestor is itself a hit", async () => {
    const region: NetworkSite = makeSite({ name: "East" });
    const market: NetworkSite = makeSite({
      name: "East Market",
      ancestors: [region],
    });
    const store: NetworkSite = makeSite({
      name: "East Store 1",
      isUnitLevel: true,
      ancestors: [region, market],
    });
    mockSiteQueries([region, market, store]);

    await callSearch({ searchText: "east" });

    expect(siteService.findBy).toHaveBeenCalledTimes(1);
    expect(resultNamed("East")["path"]).toBe("");
    expect(resultNamed("East Market")["path"]).toBe("East");
    expect(resultNamed("East Store 1")["path"]).toBe("East / East Market");
  });

  test("ancestors already among the hits are left out of the ancestor query", async () => {
    const region: NetworkSite = makeSite({ name: "Region East" });
    const market: NetworkSite = makeSite({
      name: "East Market",
      ancestors: [region],
    });
    const store: NetworkSite = makeSite({
      name: "East Store 1",
      ancestors: [region, market],
    });
    mockSiteQueries([market, store], [ancestorRow(region)]);

    await callSearch({ searchText: "east" });

    expect(siteService.findBy).toHaveBeenCalledTimes(2);
    expect(
      idsInAnyOperator((findByArgs(1)["query"] as JSONObject)["_id"]),
    ).toEqual([region.id!.toString()]);
    expect(resultNamed("East Market")["path"]).toBe("Region East");
    expect(resultNamed("East Store 1")["path"]).toBe(
      "Region East / East Market",
    );
  });

  /*
   * An ancestor the caller cannot read never comes back from the
   * permission-scoped lookup. It drops out of the path — the rest of the
   * path still prints, and the hit itself is still returned.
   */
  test("an ancestor missing from the ancestor rows simply drops out of the path", async () => {
    const region: NetworkSite = makeSite({ name: "Region East" });
    const hiddenMarket: NetworkSite = makeSite({
      name: "Secret Market",
      ancestors: [region],
    });
    const district: NetworkSite = makeSite({
      name: "District 9",
      ancestors: [region, hiddenMarket],
    });
    mockSiteQueries(
      [
        makeSite({
          name: "Store 1",
          ancestors: [region, hiddenMarket, district],
        }),
      ],
      [ancestorRow(region), ancestorRow(district)],
    );

    await callSearch({ searchText: "store" });

    const result: JSONObject = resultNamed("Store 1");
    expect(result["path"]).toBe("Region East / District 9");
    expect(result["path"]).not.toContain("Secret Market");
  });

  test("when no ancestor is readable the hit still comes back, with an empty path", async () => {
    const region: NetworkSite = makeSite({ name: "Region East" });
    mockSiteQueries([makeSite({ name: "Store 1", ancestors: [region] })], []);

    await callSearch({ searchText: "store" });

    expect(responseResults()).toHaveLength(1);
    expect(resultNamed("Store 1")["path"]).toBe("");
  });

  // A deleted or nameless ancestor has nothing to print; it is skipped too.
  test("an ancestor row with no name, or no id, contributes nothing", async () => {
    const region: NetworkSite = makeSite({ name: "Region East" });
    const namelessMarket: NetworkSite = makeSite({ ancestors: [region] });
    const district: NetworkSite = makeSite({
      name: "District 9",
      ancestors: [region, namelessMarket],
    });
    const idless: NetworkSite = new NetworkSite();
    idless.name = "Floating Row";
    mockSiteQueries(
      [
        makeSite({
          name: "Store 1",
          ancestors: [region, namelessMarket, district],
        }),
      ],
      [
        ancestorRow(region),
        ancestorRow(namelessMarket),
        ancestorRow(district),
        idless,
      ],
    );

    await callSearch({ searchText: "store" });

    expect(resultNamed("Store 1")["path"]).toBe("Region East / District 9");
  });

  /*
   * Some writers include the site's OWN id as the last path segment. The
   * site must not appear in its own path, and must not be looked up as its
   * own ancestor.
   */
  test("a path that ends in the site's own id does not repeat the site", async () => {
    const region: NetworkSite = makeSite({ name: "Region East" });
    const storeId: ObjectID = ObjectID.generate();
    const store: NetworkSite = makeSite({
      name: "Store 1",
      materializedPath: `/${region.id!.toString()}/${storeId.toString()}/`,
    });
    store.id = storeId;
    mockSiteQueries([store], [ancestorRow(region)]);

    await callSearch({ searchText: "store" });

    expect(
      idsInAnyOperator((findByArgs(1)["query"] as JSONObject)["_id"]),
    ).toEqual([region.id!.toString()]);
    expect(resultNamed("Store 1")["path"]).toBe("Region East");
  });

  // A dropped (id-less) row must not cost an ancestor lookup for its path.
  test("a row with no id does not contribute ancestors to the lookup", async () => {
    const orphanRegion: ObjectID = ObjectID.generate();
    const ghost: NetworkSite = new NetworkSite();
    ghost.name = "Ghost Store";
    ghost.materializedPath = pathThrough([orphanRegion]);
    mockSiteQueries([ghost, makeSite({ name: "Region East Store" })]);

    await callSearch({ searchText: "store" });

    expect(siteService.findBy).toHaveBeenCalledTimes(1);
    expect(responseResults()).toHaveLength(1);
  });
});

/*
 * The dropdown colours each hit by its site's current status, resolved the
 * way every other endpoint in the module resolves one: a direct fetch by id
 * rather than a relation select, which would silently demand
 * canReadOnRelationQuery. One query for the whole result set.
 */
describe("POST /network-site/search — current status", () => {
  beforeEach(() => {
    resetServiceMocks();
  });

  test("statuses are fetched once, by distinct id, scoped and permissioned", async () => {
    const props: DatabaseCommonInteractionProps = makeProps(userId);
    commonAPI.getDatabaseCommonInteractionProps.mockResolvedValue(
      props as never,
    );
    const operational: MonitorStatus = makeStatus({
      name: "Operational",
      color: "#10b981",
      priority: 1,
      isOperationalState: true,
    });
    const offline: MonitorStatus = makeStatus({
      name: "Offline",
      color: "#ef4444",
      priority: 4,
      isOfflineState: true,
    });
    mockSiteQueries([
      makeSite({ name: "Store 1", statusId: operational.id! }),
      makeSite({ name: "Store 2", statusId: operational.id! }),
      makeSite({ name: "Store 3", statusId: offline.id! }),
      makeSite({ name: "Store 4" }),
    ]);
    monitorStatusService.findBy.mockResolvedValue([
      operational,
      offline,
    ] as never);

    await callSearch({ searchText: "store" });

    expect(monitorStatusService.findBy).toHaveBeenCalledTimes(1);
    const args: JSONObject = monitorStatusService.findBy.mock
      .calls[0]![0] as JSONObject;
    const query: JSONObject = args["query"] as JSONObject;
    expect((query["projectId"] as ObjectID).toString()).toBe(
      projectId.toString(),
    );
    expect(idsInAnyOperator(query["_id"])).toEqual([
      operational.id!.toString(),
      offline.id!.toString(),
    ]);
    expect(args["select"]).toEqual({
      _id: true,
      name: true,
      color: true,
      priority: true,
      isOperationalState: true,
      isOfflineState: true,
    });
    expect(args["limit"]).toBe(LIMIT_PER_PROJECT);
    expect(args["skip"]).toBe(0);
    expect(args["props"]).toBe(props);

    expect(resultNamed("Store 1")["currentMonitorStatus"]).toEqual({
      id: operational.id!.toString(),
      name: "Operational",
      color: "#10b981",
      priority: 1,
      isOperationalState: true,
      isOfflineState: false,
    });
    expect(resultNamed("Store 2")["currentMonitorStatus"]).toEqual(
      resultNamed("Store 1")["currentMonitorStatus"],
    );
    expect(resultNamed("Store 3")["currentMonitorStatus"]).toEqual({
      id: offline.id!.toString(),
      name: "Offline",
      color: "#ef4444",
      priority: 4,
      isOperationalState: false,
      isOfflineState: true,
    });
    expect(resultNamed("Store 4")["currentMonitorStatus"]).toBeUndefined();
  });

  test("no status query when no hit has a status", async () => {
    mockSiteQueries([
      makeSite({ name: "Store 1" }),
      makeSite({ name: "Store 2" }),
    ]);

    await callSearch({ searchText: "store" });

    expect(monitorStatusService.findBy).not.toHaveBeenCalled();
    for (const result of responseResults()) {
      expect(result["currentMonitorStatus"]).toBeUndefined();
    }
  });

  /*
   * A site pointing at a status row that has since been deleted (or that
   * the caller cannot read) has no colour to offer. The hit is still
   * returned — neutral — rather than vanishing over a stale foreign key.
   */
  test("a status row that did not come back leaves the hit without a status", async () => {
    mockSiteQueries([
      makeSite({ name: "Store 1", statusId: ObjectID.generate() }),
    ]);
    monitorStatusService.findBy.mockResolvedValue([] as never);

    await callSearch({ searchText: "store" });

    expect(responseResults()).toHaveLength(1);
    expect(resultNamed("Store 1")["currentMonitorStatus"]).toBeUndefined();
  });

  test("a status row with blank fields is filled with safe defaults", async () => {
    const bare: MonitorStatus = makeStatus({});
    mockSiteQueries([makeSite({ name: "Store 1", statusId: bare.id! })]);
    monitorStatusService.findBy.mockResolvedValue([bare] as never);

    await callSearch({ searchText: "store" });

    const status: JSONObject = resultNamed("Store 1")[
      "currentMonitorStatus"
    ] as JSONObject;
    expect(status["id"]).toBe(bare.id!.toString());
    expect(status["name"]).toBe("Unknown");
    expect(status["color"]).toBeUndefined();
    expect(status["priority"]).toBe(0);
    expect(status["isOperationalState"]).toBe(false);
    expect(status["isOfflineState"]).toBe(false);
  });

  // A dropped (id-less) row's status is not worth a query either.
  test("a row with no id does not add its status to the lookup", async () => {
    const ghost: NetworkSite = new NetworkSite();
    ghost.name = "Ghost Store";
    ghost.currentMonitorStatusId = ObjectID.generate();
    mockSiteQueries([ghost]);

    await callSearch({ searchText: "ghost" });

    expect(monitorStatusService.findBy).not.toHaveBeenCalled();
    expect(lastResponseBody()).toEqual({ results: [], isTruncated: false });
  });
});

/*
 * The cap is 50 hits, and the response says when it was hit so the box can
 * tell the user to keep typing rather than let them read a partial list as
 * the whole answer. "Hit the cap" means the QUERY returned 50 rows — the
 * count after dropping unusable rows would under-report it.
 */
describe("POST /network-site/search — truncation", () => {
  beforeEach(() => {
    resetServiceMocks();
  });

  function sites(count: number): Array<NetworkSite> {
    const rows: Array<NetworkSite> = [];
    for (let index: number = 0; index < count; index++) {
      rows.push(makeSite({ name: `Store ${index}` }));
    }
    return rows;
  }

  test("49 rows is the whole answer", async () => {
    mockSiteQueries(sites(SEARCH_RESULT_LIMIT - 1));

    await callSearch({ searchText: "store" });

    expect(responseResults()).toHaveLength(SEARCH_RESULT_LIMIT - 1);
    expect(lastResponseBody()["isTruncated"]).toBe(false);
  });

  test("exactly 50 rows means there may be more", async () => {
    mockSiteQueries(sites(SEARCH_RESULT_LIMIT));

    await callSearch({ searchText: "store" });

    expect(responseResults()).toHaveLength(SEARCH_RESULT_LIMIT);
    expect(lastResponseBody()["isTruncated"]).toBe(true);
  });

  test("a single row is not truncated", async () => {
    mockSiteQueries(sites(1));

    await callSearch({ searchText: "store" });

    expect(lastResponseBody()["isTruncated"]).toBe(false);
  });

  test("50 rows is truncated even when some are dropped for having no id", async () => {
    const rows: Array<NetworkSite> = sites(SEARCH_RESULT_LIMIT - 1);
    const ghost: NetworkSite = new NetworkSite();
    ghost.name = "Ghost Store";
    rows.push(ghost);
    mockSiteQueries(rows);

    await callSearch({ searchText: "store" });

    expect(responseResults()).toHaveLength(SEARCH_RESULT_LIMIT - 1);
    expect(lastResponseBody()["isTruncated"]).toBe(true);
  });
});

/*
 * Any failure goes to next() for the standard error middleware, and no
 * half-built answer is sent. A dropdown that received "no results" when the
 * database was actually down would tell the user the site does not exist.
 */
describe("POST /network-site/search — failures", () => {
  beforeEach(() => {
    resetServiceMocks();
  });

  test("an error from the match query goes to next()", async () => {
    const failure: Error = new Error("database unavailable");
    siteService.findBy.mockRejectedValueOnce(failure as never);

    const call: SearchCall = await callSearch({ searchText: "store" });

    expect(call.next).toHaveBeenCalledTimes(1);
    expect(call.next).toHaveBeenCalledWith(failure);
    expect(responseUtil.sendJsonObjectResponse).not.toHaveBeenCalled();
    expect(monitorStatusService.findBy).not.toHaveBeenCalled();
  });

  test("an error from the ancestor query goes to next()", async () => {
    const region: NetworkSite = makeSite({ name: "Region East" });
    const failure: Error = new Error("ancestor lookup failed");
    siteService.findBy
      .mockResolvedValueOnce([
        makeSite({ name: "Store 1", ancestors: [region] }),
      ] as never)
      .mockRejectedValueOnce(failure as never);

    const call: SearchCall = await callSearch({ searchText: "store" });

    expect(call.next).toHaveBeenCalledWith(failure);
    expect(responseUtil.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test("an error from the status query goes to next()", async () => {
    const failure: Error = new Error("status lookup failed");
    mockSiteQueries([
      makeSite({ name: "Store 1", statusId: ObjectID.generate() }),
    ]);
    monitorStatusService.findBy.mockRejectedValueOnce(failure as never);

    const call: SearchCall = await callSearch({ searchText: "store" });

    expect(call.next).toHaveBeenCalledWith(failure);
    expect(responseUtil.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test("an error resolving the caller's props goes to next()", async () => {
    const failure: Error = new Error("session expired");
    commonAPI.getDatabaseCommonInteractionProps.mockRejectedValueOnce(
      failure as never,
    );

    const call: SearchCall = await callSearch({ searchText: "store" });

    expect(call.next).toHaveBeenCalledWith(failure);
    expect(siteService.findBy).not.toHaveBeenCalled();
    expect(responseUtil.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});

/*
 * The search is a read of site names and status rows, nothing more. The
 * module's other routes lean on links, device health and monitors; a search
 * that started calling any of them would be paying for data the dropdown
 * never shows, on every debounced keystroke.
 */
describe("POST /network-site/search — touches nothing else", () => {
  beforeEach(() => {
    resetServiceMocks();
  });

  test("a full search calls no link, timeline, device or monitor service", async () => {
    const region: NetworkSite = makeSite({ name: "Region East" });
    const status: MonitorStatus = makeStatus({ name: "Operational" });
    mockSiteQueries(
      [
        makeSite({
          name: "Store 1",
          ancestors: [region],
          statusId: status.id!,
        }),
      ],
      [ancestorRow(region)],
    );
    monitorStatusService.findBy.mockResolvedValue([status] as never);

    await callSearch({ searchText: "store" });

    expect(siteService.findOneBy).not.toHaveBeenCalled();
    for (const service of UNTOUCHED_SERVICES) {
      for (const method of Object.keys(service.stub)) {
        expect({
          call: `${service.name}.${method}`,
          count: service.stub[method]!.mock.calls.length,
        }).toEqual({ call: `${service.name}.${method}`, count: 0 });
      }
    }
  });
});
