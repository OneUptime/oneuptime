import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import NotOnWatchlist from "../../../Types/BaseDatabase/NotOnWatchlist";
import OnWatchlist from "../../../Types/BaseDatabase/OnWatchlist";
import Query from "../../../Types/BaseDatabase/Query";
import Search from "../../../Types/BaseDatabase/Search";
import ObjectID from "../../../Types/ObjectID";
import {
  SecurityEventSearchFilters,
  applySecurityEventSearchToQuery,
  hasSecurityEventSearch,
  parseSecurityEventSearch,
} from "../../../Utils/SecurityEvent/SecurityEventSearch";
import {
  buildSecurityHuntQuery,
  getSecurityHuntWatchlistNames,
} from "../../../Utils/SecurityEvent/SecurityHuntSearch";
import { describe, expect, test } from "@jest/globals";

/*
 * A SEARCH THAT READS A WATCHLIST (#5391): `user:%vip_users%` on the Events
 * page and in a hunt is "the field is on the list", `-ip:%admin_addresses%`
 * is "not on it" - as a rule's `expand` and its `not` read them. The
 * search carries the list's name only; the server reads the list before
 * the read runs.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);

function parsed(search: string): SecurityEventSearchFilters {
  return parseSecurityEventSearch(search);
}

describe("a field's value that is a list's name between % signs", () => {
  test("reads the list, on a field by any of its names", () => {
    expect(parsed("user:%vip_users%").fields).toEqual({
      principalUser: new OnWatchlist("vip_users"),
    });
    expect(parsed("principalUser:%vip_users%").fields).toEqual({
      principalUser: new OnWatchlist("vip_users"),
    });
    expect(parsed("targetIp:%tor_exits%").fields).toEqual({
      targetIp: new OnWatchlist("tor_exits"),
    });
    expect(parsed("observables:%bad_domains%").fields).toEqual({
      observables: new OnWatchlist("bad_domains"),
    });
    expect(parsed("user:%vip_users%").fields["principalUser"]).toBeInstanceOf(
      OnWatchlist,
    );
  });

  test("a minus in front, or a ! before the value, keeps what is not on the list", () => {
    expect(parsed("-ip:%admin_addresses%").fields).toEqual({
      principalIp: new NotOnWatchlist("admin_addresses"),
    });
    expect(parsed("ip:!%admin_addresses%").fields).toEqual({
      principalIp: new NotOnWatchlist("admin_addresses"),
    });
  });

  test("the name is kept as written: a list is found whatever its case", () => {
    expect(parsed("user:%VIP_Users%").fields).toEqual({
      principalUser: new OnWatchlist("VIP_Users"),
    });
  });

  test("an attribute reads a list too, and so does a name that is no column", () => {
    expect(parsed("@src.user:%vip_users%").attributes).toEqual({
      "src.user": new OnWatchlist("vip_users"),
    });
    expect(parsed("-@src.ip:%admin_addresses%").attributes).toEqual({
      "src.ip": new NotOnWatchlist("admin_addresses"),
    });
    expect(parsed("zone:%dmz_hosts%").attributes).toEqual({
      zone: new OnWatchlist("dmz_hosts"),
    });
  });

  test("sits beside the search's other filters", () => {
    const filters: SecurityEventSearchFilters = parsed(
      "failed logon user:%vip_users% severity:High",
    );

    expect(filters).toEqual({
      freeText: "failed logon",
      fields: {
        principalUser: new OnWatchlist("vip_users"),
        severityName: "High",
      },
      attributes: {},
    });
    expect(hasSecurityEventSearch("user:%vip_users%")).toBe(true);
  });
});

describe("what is not a list's name stays the value it always was", () => {
  test("a number field: a port is never on a list", () => {
    expect(parsed("targetPort:%x%").fields["targetPort"]).not.toBeInstanceOf(
      OnWatchlist,
    );
  });

  test("a name that is not one, or more than a name between the signs", () => {
    for (const search of [
      "user:%vip-users%",
      "user:%vip users%",
      "user:%%",
      "user:%vip_users",
      "user:vip_users%",
      "user:%a%b%",
      "user:x%vip_users%",
    ]) {
      const value: unknown = parsed(search).fields["principalUser"];

      expect({ search, onList: value instanceof OnWatchlist }).toEqual({
        search,
        onList: false,
      });
    }
  });

  test("an operator other than equals or not equals", () => {
    expect(parsed("user:~%vip_users%").fields["principalUser"]).toStrictEqual(
      new Search("%vip_users%"),
    );
    expect(parsed("-user:alice").fields["principalUser"]).toStrictEqual(
      new NotEqual("alice"),
    );
  });

  test("free text: a name between % signs alone searches the message", () => {
    expect(parsed("%vip_users%")).toEqual({
      freeText: "%vip_users%",
      fields: {},
      attributes: {},
    });
  });
});

describe("a search over a query", () => {
  test("puts the list on its field, and merges an attribute's into the attributes there", () => {
    // Through unknown: a literal held to the query's whole type is too deep to check.
    const base: Query<SecurityEvent> = {
      projectId: PROJECT_ID,
      attributes: { env: "prod" },
    } as unknown as Query<SecurityEvent>;

    const query: Query<SecurityEvent> = applySecurityEventSearchToQuery({
      query: base,
      filters: parsed("user:%vip_users% @src.ip:%admins%"),
    });

    expect(query).toEqual({
      projectId: PROJECT_ID,
      principalUser: new OnWatchlist("vip_users"),
      attributes: { env: "prod", "src.ip": new OnWatchlist("admins") },
    });
    expect(base).toEqual({
      projectId: PROJECT_ID,
      attributes: { env: "prod" },
    });
  });
});

describe("the lists a hunt's search reads", () => {
  test("each once, in the order it names them, from fields and attributes", () => {
    expect(
      getSecurityHuntWatchlistNames(
        "user:%vip_users% -ip:%admin_addresses% host:%VIP_USERS% @src.zone:%dmz%",
      ),
    ).toEqual(["vip_users", "admin_addresses", "dmz"]);
  });

  test("a search that reads none reads none", () => {
    expect(getSecurityHuntWatchlistNames("failed logon user:alice")).toEqual(
      [],
    );
    expect(getSecurityHuntWatchlistNames("user:~%vip_users%")).toEqual([]);
    expect(getSecurityHuntWatchlistNames("")).toEqual([]);
    expect(getSecurityHuntWatchlistNames(null)).toEqual([]);
    expect(getSecurityHuntWatchlistNames(undefined)).toEqual([]);
  });

  test("a hunt's read carries the list's name, as the Events page's does", () => {
    const start: Date = new Date("2026-11-03T11:00:00.000Z");
    const end: Date = new Date("2026-11-03T12:00:00.000Z");

    expect(
      buildSecurityHuntQuery({
        projectId: PROJECT_ID,
        searchQuery: "-ip:%admin_addresses% user:%vip_users%",
        filters: {},
        startTime: start,
        endTime: end,
      }),
    ).toEqual({
      projectId: PROJECT_ID,
      time: new InBetween<Date>(start, end),
      principalIp: new NotOnWatchlist("admin_addresses"),
      principalUser: new OnWatchlist("vip_users"),
    });
  });
});
