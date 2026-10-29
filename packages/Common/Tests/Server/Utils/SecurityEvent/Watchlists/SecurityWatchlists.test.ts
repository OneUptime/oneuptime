import DetectionRule from "../../../../../Models/DatabaseModels/DetectionRule";
import SecurityWatchlist from "../../../../../Models/DatabaseModels/SecurityWatchlist";
import SecurityWatchlistItem from "../../../../../Models/DatabaseModels/SecurityWatchlistItem";
import DetectionRuleService from "../../../../../Server/Services/DetectionRuleService";
import SecurityWatchlistItemService from "../../../../../Server/Services/SecurityWatchlistItemService";
import SecurityWatchlistService from "../../../../../Server/Services/SecurityWatchlistService";
import SecurityWatchlists, {
  SecurityWatchlistReader,
} from "../../../../../Server/Utils/SecurityEvent/Watchlists/SecurityWatchlists";
import Includes from "../../../../../Types/BaseDatabase/Includes";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { SecurityEntityType } from "../../../../../Types/SecurityCase/SecurityEntity";
import {
  SecurityWatchlistSource,
  SigmaWatchlist,
  SigmaWatchlists,
} from "../../../../../Types/SecurityEvent/SecurityWatchlist";
import { DetectionRuleDefinition } from "../../../../../Types/SecurityEvent/SigmaCorrelation";
import SigmaRule from "../../../../../Types/SecurityEvent/SigmaRule";
import SigmaRuleSetParser from "../../../../../Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import { getJestSpyOn } from "../../../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A PROJECT'S WATCHLISTS, AS ITS RULES READ THEM: the lists a rule names,
 * read from the project as the server (every read is root, and only the
 * rule's own project's), the values of those kept by hand split by how
 * they match, a list that follows a feed as the feed it follows - and a
 * reader that reads each list once for a turn of the engine.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "12121212-1212-4212-8212-121212121212",
);
const VIP_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ADMINS_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const TOR_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const FEED_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";

function watchlistRow(data: {
  id: string;
  name: string;
  entityType: SecurityEntityType;
  source?: SecurityWatchlistSource;
  feedId?: string;
}): SecurityWatchlist {
  const row: SecurityWatchlist = new SecurityWatchlist();
  row._id = data.id;
  row.name = data.name;
  row.entityType = data.entityType;
  row.source = data.source || SecurityWatchlistSource.Values;

  if (data.feedId) {
    row.threatIntelFeedId = new ObjectID(data.feedId);
  }

  return row;
}

function itemRow(watchlistId: string, value: string): SecurityWatchlistItem {
  const row: SecurityWatchlistItem = new SecurityWatchlistItem();
  row.securityWatchlistId = new ObjectID(watchlistId);
  row.value = value;
  return row;
}

const VIP_ROW: SecurityWatchlist = watchlistRow({
  id: VIP_ID,
  name: "VIP_Users",
  entityType: SecurityEntityType.User,
});

const ADMINS_ROW: SecurityWatchlist = watchlistRow({
  id: ADMINS_ID,
  name: "admin_addresses",
  entityType: SecurityEntityType.IpAddress,
});

const TOR_ROW: SecurityWatchlist = watchlistRow({
  id: TOR_ID,
  name: "tor_exits",
  entityType: SecurityEntityType.IpAddress,
  source: SecurityWatchlistSource.ThreatIntelFeed,
  feedId: FEED_ID,
});

function stubLists(rows: Array<SecurityWatchlist>): Spy {
  return getJestSpyOn(SecurityWatchlistService, "findAllBy").mockResolvedValue(
    rows as never,
  );
}

function stubItems(rows: Array<SecurityWatchlistItem>): Spy {
  return getJestSpyOn(
    SecurityWatchlistItemService,
    "findAllBy",
  ).mockResolvedValue(rows as never);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SecurityWatchlists.load", () => {
  test("the lists named, whatever the case, read as root in the project", async () => {
    const lists: Spy = stubLists([VIP_ROW]);
    stubItems([]);

    await SecurityWatchlists.load({
      projectId: PROJECT_ID,
      names: ["vip_users", " VIP_USERS ", "admins", ""],
    });

    expect(lists).toHaveBeenCalledTimes(1);

    const args: { query: JSONObject; props: JSONObject; select: JSONObject } =
      lists.mock.calls[0]![0] as {
        query: JSONObject;
        props: JSONObject;
        select: JSONObject;
      };

    expect(args.query["projectId"]).toBe(PROJECT_ID);
    // One case-insensitive lookup of every name, each once.
    expect(args.query["name"]).toBeDefined();
    expect(args.props).toEqual({ isRoot: true });
    expect(args.select).toEqual({
      _id: true,
      name: true,
      entityType: true,
      source: true,
      threatIntelFeedId: true,
    });
  });

  test("no name is no read", async () => {
    const lists: Spy = stubLists([]);

    expect(
      (await SecurityWatchlists.load({ projectId: PROJECT_ID, names: [] }))
        .size,
    ).toBe(0);
    expect(lists).not.toHaveBeenCalled();
  });

  test("the values of the lists kept by hand, in one read, split by how they match", async () => {
    stubLists([VIP_ROW, ADMINS_ROW]);
    const items: Spy = stubItems([
      itemRow(VIP_ID, "Alice"),
      itemRow(VIP_ID, "svc-*"),
      itemRow(ADMINS_ID, "10.20.0.0/16"),
      itemRow(ADMINS_ID, "203.0.113.7"),
    ]);

    const loaded: Map<string, SigmaWatchlist> = await SecurityWatchlists.load({
      projectId: PROJECT_ID,
      names: ["vip_users", "admin_addresses"],
    });

    expect(items).toHaveBeenCalledTimes(1);

    const args: { query: JSONObject; props: JSONObject } = items.mock
      .calls[0]![0] as { query: JSONObject; props: JSONObject };

    expect(args.query["projectId"]).toBe(PROJECT_ID);
    expect((args.query["securityWatchlistId"] as Includes).values).toEqual([
      VIP_ID,
      ADMINS_ID,
    ]);
    expect(args.props).toEqual({ isRoot: true });

    expect(loaded.get("vip_users")).toEqual({
      name: "VIP_Users",
      entityType: SecurityEntityType.User,
      exactValues: ["alice"],
      patterns: ["svc-*"],
      ranges: [],
    });
    expect(loaded.get("admin_addresses")).toEqual({
      name: "admin_addresses",
      entityType: SecurityEntityType.IpAddress,
      exactValues: ["203.0.113.7"],
      patterns: [],
      ranges: ["10.20.0.0/16"],
    });
  });

  test("a list that follows a feed is the feed it follows, with none of its values read", async () => {
    stubLists([TOR_ROW]);
    const items: Spy = stubItems([]);

    const loaded: Map<string, SigmaWatchlist> = await SecurityWatchlists.load({
      projectId: PROJECT_ID,
      names: ["tor_exits"],
    });

    expect(items).not.toHaveBeenCalled();
    expect(loaded.get("tor_exits")).toEqual({
      name: "tor_exits",
      entityType: SecurityEntityType.IpAddress,
      exactValues: [],
      patterns: [],
      ranges: [],
      threatIntelFeed: {
        projectId: PROJECT_ID.toString(),
        feedId: FEED_ID,
        indicatorTypes: ["ipv4-addr", "ipv6-addr"],
      },
    });
  });

  test("a feed list whose feed is gone follows nothing: an empty list", async () => {
    stubLists([
      watchlistRow({
        id: TOR_ID,
        name: "tor_exits",
        entityType: SecurityEntityType.IpAddress,
        source: SecurityWatchlistSource.ThreatIntelFeed,
      }),
    ]);
    stubItems([]);

    const loaded: Map<string, SigmaWatchlist> = await SecurityWatchlists.load({
      projectId: PROJECT_ID,
      names: ["tor_exits"],
    });

    expect(loaded.get("tor_exits")!.threatIntelFeed).toBeUndefined();
  });

  test("two rows a race let share a name: the first is the list", async () => {
    stubLists([
      VIP_ROW,
      watchlistRow({
        id: ADMINS_ID,
        name: "vip_users",
        entityType: SecurityEntityType.Host,
      }),
    ]);
    stubItems([itemRow(VIP_ID, "alice"), itemRow(ADMINS_ID, "web-01")]);

    const loaded: Map<string, SigmaWatchlist> = await SecurityWatchlists.load({
      projectId: PROJECT_ID,
      names: ["vip_users"],
    });

    expect(loaded.size).toBe(1);
    expect(loaded.get("vip_users")!.exactValues).toEqual(["alice"]);
  });

  test("a read that fails is not swallowed: no rule runs blind to its lists", async () => {
    getJestSpyOn(SecurityWatchlistService, "findAllBy").mockRejectedValue(
      new Error("database is down") as never,
    );

    await expect(
      SecurityWatchlists.load({ projectId: PROJECT_ID, names: ["vip_users"] }),
    ).rejects.toThrow("database is down");
  });
});

describe("SecurityWatchlistReader: one turn's lists", () => {
  const RULE: string = `title: VIP sign-in
detection:
  selection:
    principalUser|expand: '%vip_users%'
  condition: selection
`;

  test("each list is read once, however many rules name it", async () => {
    const lists: Spy = stubLists([VIP_ROW]);
    stubItems([itemRow(VIP_ID, "alice")]);

    const reader: SecurityWatchlistReader =
      SecurityWatchlists.readerFor(PROJECT_ID);

    await reader.bind(SigmaRuleSetParser.parse(RULE));
    await reader.bind(SigmaRuleSetParser.parse(RULE));
    await reader.read([{ name: "VIP_users", key: "vip_users" }]);

    expect(lists).toHaveBeenCalledTimes(1);
  });

  test("a name the project does not have is remembered as missing, and asked once", async () => {
    const lists: Spy = stubLists([]);
    stubItems([]);

    const reader: SecurityWatchlistReader =
      SecurityWatchlists.readerFor(PROJECT_ID);

    expect(await reader.read([{ name: "nope", key: "nope" }])).toEqual({});
    expect(await reader.read([{ name: "nope", key: "nope" }])).toEqual({});
    expect(lists).toHaveBeenCalledTimes(1);
  });

  test("bind gives the rule the lists it names", async () => {
    stubLists([VIP_ROW]);
    stubItems([itemRow(VIP_ID, "alice")]);

    const bound: DetectionRuleDefinition = await SecurityWatchlists.readerFor(
      PROJECT_ID,
    ).bind(SigmaRuleSetParser.parse(RULE));
    const watchlists: SigmaWatchlists | undefined = (
      bound as { rule: SigmaRule }
    ).rule.watchlists;

    expect(watchlists!["vip_users"]!.exactValues).toEqual(["alice"]);
  });

  test("bind refuses a rule that names a list the project does not have, naming it", async () => {
    stubLists([]);
    stubItems([]);

    const binding: Promise<DetectionRuleDefinition> =
      SecurityWatchlists.readerFor(PROJECT_ID).bind(
        SigmaRuleSetParser.parse(RULE),
      );

    await expect(binding).rejects.toThrow(BadDataException);
    await expect(
      SecurityWatchlists.readerFor(PROJECT_ID).bind(
        SigmaRuleSetParser.parse(RULE),
      ),
    ).rejects.toThrow("There is no watchlist named vip_users in this project.");
  });

  test("a rule that names no list is bound as it is, with nothing read", async () => {
    const lists: Spy = stubLists([]);
    const definition: DetectionRuleDefinition = SigmaRuleSetParser.parse(
      "title: x\ndetection:\n  s:\n    principalUser: a\n  condition: s\n",
    );

    expect(
      await SecurityWatchlists.readerFor(PROJECT_ID).bind(definition),
    ).toBe(definition);
    expect(lists).not.toHaveBeenCalled();
  });
});

describe("SecurityWatchlists.findRulesReading", () => {
  test("the project's rules, read as root, by the lists they name", async () => {
    const rule: DetectionRule = new DetectionRule();
    rule._id = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
    rule.name = "VIP sign-in";
    rule.sigmaRuleYaml = `title: VIP sign-in
detection:
  selection:
    principalUser|expand: '%vip_users%'
  condition: selection
`;

    const rules: Spy = getJestSpyOn(
      DetectionRuleService,
      "findAllBy",
    ).mockResolvedValue([rule] as never);

    const readers: Map<
      string,
      Array<{ id: string; name: string }>
    > = await SecurityWatchlists.findRulesReading(PROJECT_ID);

    expect(readers.get("vip_users")).toEqual([
      { id: rule._id, name: "VIP sign-in" },
    ]);

    const args: { query: JSONObject; props: JSONObject; select: JSONObject } =
      rules.mock.calls[0]![0] as {
        query: JSONObject;
        props: JSONObject;
        select: JSONObject;
      };

    expect(args.query).toEqual({ projectId: PROJECT_ID });
    expect(args.props).toEqual({ isRoot: true });
    expect(args.select).toEqual({ _id: true, name: true, sigmaRuleYaml: true });
  });
});
