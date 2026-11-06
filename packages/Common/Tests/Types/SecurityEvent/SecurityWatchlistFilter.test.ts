import { describe, expect, test } from "@jest/globals";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import Includes from "../../../Types/BaseDatabase/Includes";
import NotOnWatchlist from "../../../Types/BaseDatabase/NotOnWatchlist";
import OnWatchlist from "../../../Types/BaseDatabase/OnWatchlist";
import Query from "../../../Types/BaseDatabase/Query";
import Search from "../../../Types/BaseDatabase/Search";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import { SECURITY_WATCHLIST_ENTITY_TYPES } from "../../../Types/SecurityEvent/SecurityWatchlist";
import {
  SECURITY_WATCHLIST_FILTERS_MAX,
  SECURITY_WATCHLIST_FILTER_FIELDS,
  SECURITY_WATCHLIST_FILTER_MESSAGES,
  SecurityWatchlistFilter,
  WatchlistReader,
  WatchlistReaderKind,
  applySecurityWatchlistFiltersToQuery,
  describeSecurityWatchlistFilters,
  describeWatchlistReaders,
  getDefaultSecurityWatchlistFilterField,
  getSecurityWatchlistFiltersProblem,
  getWatchlistNamesInQuery,
  isSecurityWatchlistFilterField,
  isWatchlistOperator,
  readSecurityWatchlistFilters,
  toSecurityWatchlistFiltersJSON,
} from "../../../Types/SecurityEvent/SecurityWatchlistFilter";

/*
 * READING A WATCHLIST OUTSIDE A RULE (#5391): a Security Events monitor's
 * Filter by Watchlists rows, the operators a query carries a list's name
 * in (OnWatchlist, NotOnWatchlist), the lists a query reads, and the words
 * a refusal names what reads a list with.
 */

describe("the operators a query carries a list's name in", () => {
  test("each carries only the name, and writes it as the search bar does", () => {
    const on: OnWatchlist = new OnWatchlist("vip_users");
    const notOn: NotOnWatchlist = new NotOnWatchlist("admin_addresses");

    expect(on.value).toBe("vip_users");
    expect(on.toString()).toBe("%vip_users%");
    expect(notOn.value).toBe("admin_addresses");
    expect(notOn.toString()).toBe("%admin_addresses%");
  });

  test("each is JSON of its own type, read back as itself", () => {
    expect(new OnWatchlist("vip_users").toJSON()).toEqual({
      _type: ObjectType.OnWatchlist,
      value: "vip_users",
    });
    expect(new NotOnWatchlist("admin_addresses").toJSON()).toEqual({
      _type: ObjectType.NotOnWatchlist,
      value: "admin_addresses",
    });
    expect(
      OnWatchlist.fromJSON({ _type: ObjectType.OnWatchlist, value: "a" }),
    ).toEqual(new OnWatchlist("a"));
    expect(
      NotOnWatchlist.fromJSON({ _type: ObjectType.NotOnWatchlist, value: "b" }),
    ).toEqual(new NotOnWatchlist("b"));
  });

  test("JSON of another type is refused, and a name that is not text reads as none", () => {
    expect(() => {
      OnWatchlist.fromJSON({ _type: ObjectType.NotOnWatchlist, value: "a" });
    }).toThrow(BadDataException);
    expect(() => {
      NotOnWatchlist.fromJSON({ _type: ObjectType.OnWatchlist, value: "a" });
    }).toThrow(BadDataException);
    expect(
      OnWatchlist.fromJSON({ _type: ObjectType.OnWatchlist, value: 42 }).value,
    ).toBe("");
  });

  test("a query sent to the API comes back with the same operators, on fields and in an AND", () => {
    const query: JSONObject = {
      principalUser: new OnWatchlist("vip_users"),
      principalIp: [
        new NotOnWatchlist("admin_addresses"),
        new OnWatchlist("vpn_ranges"),
      ],
    } as unknown as JSONObject;

    const sent: JSONObject = JSON.parse(
      JSON.stringify(JSONFunctions.serialize(query)),
    ) as JSONObject;
    const received: JSONObject = JSONFunctions.deserialize(sent);

    expect(received["principalUser"]).toBeInstanceOf(OnWatchlist);
    expect(received["principalUser"]).toEqual(new OnWatchlist("vip_users"));
    expect(received["principalIp"]).toEqual([
      new NotOnWatchlist("admin_addresses"),
      new OnWatchlist("vpn_ranges"),
    ]);
    expect((received["principalIp"] as Array<unknown>)[0]).toBeInstanceOf(
      NotOnWatchlist,
    );
  });

  test("an operator that reads a list is told from every other", () => {
    expect(isWatchlistOperator(new OnWatchlist("a"))).toBe(true);
    expect(isWatchlistOperator(new NotOnWatchlist("a"))).toBe(true);
    expect(isWatchlistOperator(new Search("%a%"))).toBe(false);
    expect(isWatchlistOperator("%a%")).toBe(false);
    expect(isWatchlistOperator(null)).toBe(false);
  });
});

describe("the fields a monitor reads a list in", () => {
  test("who acted, what they acted on, the process, and the event's observables", () => {
    expect([...SECURITY_WATCHLIST_FILTER_FIELDS]).toEqual([
      "principalUser",
      "principalHost",
      "principalIp",
      "targetUser",
      "targetHost",
      "targetIp",
      "processName",
      "observables",
    ]);

    for (const field of SECURITY_WATCHLIST_FILTER_FIELDS) {
      expect(isSecurityWatchlistFilterField(field)).toBe(true);
    }

    expect(isSecurityWatchlistFilterField("message")).toBe(false);
    expect(isSecurityWatchlistFilterField("attributes")).toBe(false);
    expect(isSecurityWatchlistFilterField(undefined)).toBe(false);
  });

  test("every field is a text field of a security event", () => {
    const event: SecurityEvent = new SecurityEvent();

    for (const field of SECURITY_WATCHLIST_FILTER_FIELDS) {
      expect({ field, known: Boolean(event.getTableColumn(field)) }).toEqual({
        field,
        known: true,
      });
    }
  });

  test("a new filter starts on the field a list of its kind is usually in", () => {
    expect(
      SECURITY_WATCHLIST_ENTITY_TYPES.map(
        (entityType: SecurityEntityType): string => {
          return getDefaultSecurityWatchlistFilterField(entityType);
        },
      ),
    ).toEqual([
      "principalUser",
      "principalHost",
      "principalIp",
      "observables",
      "observables",
      "observables",
      "processName",
      "observables",
    ]);
    expect(getDefaultSecurityWatchlistFilterField(undefined)).toBe(
      "observables",
    );
  });
});

describe("a monitor's stored filters", () => {
  test("read as written, the name trimmed, 'not on' only when it says so", () => {
    expect(
      readSecurityWatchlistFilters([
        { field: " principalUser ", watchlist: " vip_users " },
        { field: "principalIp", watchlist: "admins", isNotOnList: true },
        { field: "principalIp", watchlist: "admins", isNotOnList: "yes" },
      ]),
    ).toEqual([
      { field: "principalUser", watchlist: "vip_users", isNotOnList: false },
      { field: "principalIp", watchlist: "admins", isNotOnList: true },
      { field: "principalIp", watchlist: "admins", isNotOnList: false },
    ]);
  });

  test("anything that is not a list of rows is none, and a row that is not one is left out", () => {
    expect(readSecurityWatchlistFilters(undefined)).toEqual([]);
    expect(readSecurityWatchlistFilters("principalUser:%vip%")).toEqual([]);
    expect(readSecurityWatchlistFilters({ field: "principalUser" })).toEqual(
      [],
    );
    expect(
      readSecurityWatchlistFilters([null, 3, "x", ["principalUser", "vip"]]),
    ).toEqual([]);
    // A row with no field or list is kept, for the form to show unfinished.
    expect(readSecurityWatchlistFilters([{}])).toEqual([
      { field: "", watchlist: "", isNotOnList: false },
    ]);
  });

  test("written as JSON with every key, and read back the same", () => {
    const filters: Array<SecurityWatchlistFilter> = [
      { field: "principalUser", watchlist: "vip_users" },
      { field: "principalIp", watchlist: "admins", isNotOnList: true },
    ];

    const json: Array<JSONObject> = toSecurityWatchlistFiltersJSON(filters);

    expect(json).toEqual([
      { field: "principalUser", watchlist: "vip_users", isNotOnList: false },
      { field: "principalIp", watchlist: "admins", isNotOnList: true },
    ]);
    expect(readSecurityWatchlistFilters(json)).toEqual(json);
    expect(toSecurityWatchlistFiltersJSON(undefined)).toEqual([]);
  });
});

describe("what is wrong with a monitor's filters", () => {
  test("none, or every row with a field and a list, is fine", () => {
    expect(getSecurityWatchlistFiltersProblem(undefined)).toBeNull();
    expect(getSecurityWatchlistFiltersProblem([])).toBeNull();
    expect(
      getSecurityWatchlistFiltersProblem([
        { field: "principalUser", watchlist: "vip_users" },
        { field: "observables", watchlist: "bad_domains", isNotOnList: true },
      ]),
    ).toBeNull();
  });

  test("a row without a list, or without a field it reads a list in, says which", () => {
    expect(
      getSecurityWatchlistFiltersProblem([
        { field: "principalUser", watchlist: "" },
      ]),
    ).toBe(SECURITY_WATCHLIST_FILTER_MESSAGES.chooseWatchlist.message);
    expect(
      getSecurityWatchlistFiltersProblem([
        { field: "principalUser", watchlist: "not-a-name" },
      ]),
    ).toBe(SECURITY_WATCHLIST_FILTER_MESSAGES.chooseWatchlist.message);
    expect(
      getSecurityWatchlistFiltersProblem([
        { field: "message", watchlist: "vip_users" },
      ]),
    ).toBe(SECURITY_WATCHLIST_FILTER_MESSAGES.chooseField.message);
  });

  test("at most 10 rows, and the message says so", () => {
    const row: SecurityWatchlistFilter = {
      field: "principalUser",
      watchlist: "vip_users",
    };

    expect(SECURITY_WATCHLIST_FILTERS_MAX).toBe(10);
    expect(SECURITY_WATCHLIST_FILTER_MESSAGES.tooManyFilters.message).toContain(
      `${SECURITY_WATCHLIST_FILTERS_MAX} watchlist filters`,
    );
    expect(
      getSecurityWatchlistFiltersProblem(
        new Array(SECURITY_WATCHLIST_FILTERS_MAX).fill(row),
      ),
    ).toBeNull();
    expect(
      getSecurityWatchlistFiltersProblem(
        new Array(SECURITY_WATCHLIST_FILTERS_MAX + 1).fill(row),
      ),
    ).toBe(SECURITY_WATCHLIST_FILTER_MESSAGES.tooManyFilters.message);
  });
});

describe("a monitor's filters over its query", () => {
  test("each row puts its list on its field, and leaves the query it was given alone", () => {
    const given: Query<SecurityEvent> = {
      severityName: new Includes(["High"]),
    };

    const query: Query<SecurityEvent> = applySecurityWatchlistFiltersToQuery(
      given,
      [
        { field: "principalUser", watchlist: " vip_users " },
        { field: "principalIp", watchlist: "admins", isNotOnList: true },
      ],
    );

    expect(query).toEqual({
      severityName: new Includes(["High"]),
      principalUser: new OnWatchlist("vip_users"),
      principalIp: new NotOnWatchlist("admins"),
    });
    expect(given).toEqual({ severityName: new Includes(["High"]) });
  });

  test("a field the query already filters must meet both: the filters join it in an AND", () => {
    expect(
      applySecurityWatchlistFiltersToQuery(
        { principalUser: new Search("svc") } as Query<SecurityEvent>,
        [
          { field: "principalUser", watchlist: "vip_users" },
          { field: "principalUser", watchlist: "leavers", isNotOnList: true },
        ],
      ),
    ).toEqual({
      principalUser: [
        new Search("svc"),
        new OnWatchlist("vip_users"),
        new NotOnWatchlist("leavers"),
      ],
    });
  });

  test("an unfinished row adds nothing", () => {
    expect(
      applySecurityWatchlistFiltersToQuery({}, [
        { field: "principalUser", watchlist: "" },
        { field: "nope", watchlist: "vip_users" },
      ]),
    ).toEqual({});
    expect(applySecurityWatchlistFiltersToQuery({}, undefined)).toEqual({});
  });

  test("written as the Events search writes them, an unfinished row left out", () => {
    expect(
      describeSecurityWatchlistFilters([
        { field: "principalUser", watchlist: "vip_users" },
        { field: "principalIp", watchlist: "admins", isNotOnList: true },
        { field: "principalHost", watchlist: "" },
      ]),
    ).toEqual(["principalUser:%vip_users%", "-principalIp:%admins%"]);
    expect(describeSecurityWatchlistFilters(undefined)).toEqual([]);
  });
});

describe("the lists a query reads", () => {
  test("its fields', each element of an AND, and its attributes', each once whatever the case", () => {
    expect(
      getWatchlistNamesInQuery({
        principalUser: new OnWatchlist("vip_users"),
        principalIp: [new NotOnWatchlist("admins"), new Search("10.")],
        attributes: {
          "src.user": new OnWatchlist("VIP_Users"),
          zone: new OnWatchlist("dmz_hosts"),
          plain: "value",
        },
        message: new Search("%vip_users%"),
      }),
    ).toEqual(["vip_users", "admins", "dmz_hosts"]);
  });

  test("a query that reads none, or is not a query, reads none", () => {
    expect(getWatchlistNamesInQuery({ message: "x" })).toEqual([]);
    expect(getWatchlistNamesInQuery({})).toEqual([]);
    expect(getWatchlistNamesInQuery(undefined)).toEqual([]);
    expect(getWatchlistNamesInQuery("principalUser:%vip%")).toEqual([]);
  });
});

describe("what reads a list, named for a refusal", () => {
  function reader(kind: WatchlistReaderKind, name: string): WatchlistReader {
    return { kind, id: name, name };
  }

  test("each with what it is, a rule, a monitor or a hunt", () => {
    expect(
      describeWatchlistReaders([
        reader(WatchlistReaderKind.DetectionRule, "Admin sign-in"),
        reader(WatchlistReaderKind.Monitor, "VIP failures"),
        reader(WatchlistReaderKind.Hunt, "Weekly VIP review"),
      ]),
    ).toBe(
      "Admin sign-in (rule), VIP failures (monitor), Weekly VIP review (hunt)",
    );
  });

  test("three at most, then how many more", () => {
    expect(
      describeWatchlistReaders([
        reader(WatchlistReaderKind.DetectionRule, "A"),
        reader(WatchlistReaderKind.DetectionRule, "B"),
        reader(WatchlistReaderKind.Monitor, "C"),
        reader(WatchlistReaderKind.Hunt, "D"),
        reader(WatchlistReaderKind.Hunt, "E"),
      ]),
    ).toBe("A (rule), B (rule), C (monitor) and 2 more");
  });

  test("one without a name is still named by what it is", () => {
    expect(
      describeWatchlistReaders([reader(WatchlistReaderKind.Monitor, "")]),
    ).toBe("a monitor with no name (monitor)");
  });
});
