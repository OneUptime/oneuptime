import { describe, expect, test } from "@jest/globals";
import SecurityWatchlist from "../../../Models/DatabaseModels/SecurityWatchlist";
import SecurityWatchlistItem from "../../../Models/DatabaseModels/SecurityWatchlistItem";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import {
  SECURITY_WATCHLISTS_PER_PROJECT_MAX,
  SECURITY_WATCHLIST_DEFAULT_SNIPPET_FIELD,
  SECURITY_WATCHLIST_DESCRIPTION_MAX_LENGTH,
  SECURITY_WATCHLIST_ENTITY_TYPES,
  SECURITY_WATCHLIST_FEED_ENTITY_TYPES,
  SECURITY_WATCHLIST_FEED_INDICATOR_TYPES,
  SECURITY_WATCHLIST_IMPORT_MAX_CHARACTERS,
  SECURITY_WATCHLIST_MODIFIER,
  SECURITY_WATCHLIST_NAME_MAX_LENGTH,
  SECURITY_WATCHLIST_NOTE_MAX_LENGTH,
  SECURITY_WATCHLIST_PATTERN_VALUES_MAX,
  SECURITY_WATCHLIST_RANGE_VALUES_MAX,
  SECURITY_WATCHLIST_SNIPPET_FIELDS,
  SECURITY_WATCHLIST_SOURCES,
  SECURITY_WATCHLIST_VALUES_MAX,
  SECURITY_WATCHLIST_VALUE_MAX_LENGTH,
  SecurityWatchlistImportMode,
  SecurityWatchlistImportResult,
  SecurityWatchlistProblem,
  SecurityWatchlistSource,
  SecurityWatchlistValueMatch,
  canSecurityWatchlistFollowFeed,
  countSecurityWatchlistValues,
  getMissingSecurityWatchlistsMessage,
  getSecurityWatchlistFeedIndicatorTypes,
  getSecurityWatchlistNameKey,
  getSecurityWatchlistNameProblem,
  getSecurityWatchlistNoteProblem,
  getSecurityWatchlistPlaceholder,
  getSecurityWatchlistProblem,
  getSecurityWatchlistProblems,
  getSecurityWatchlistRuleSnippet,
  getSecurityWatchlistSizeProblem,
  getSecurityWatchlistSnippetField,
  getSecurityWatchlistValueKey,
  getSecurityWatchlistValueMatch,
  getSecurityWatchlistValueProblem,
  isSecurityWatchlistEntityType,
  isSecurityWatchlistImportMode,
  isSecurityWatchlistName,
  isSecurityWatchlistSource,
  matchesSecurityWatchlistPattern,
  normalizeSecurityWatchlistName,
  normalizeSecurityWatchlistNote,
  normalizeSecurityWatchlistValue,
  parseSecurityWatchlistImport,
  readSecurityWatchlistImportLine,
  readSecurityWatchlistPlaceholder,
  splitSecurityWatchlistValues,
} from "../../../Types/SecurityEvent/SecurityWatchlist";
import { ThreatIntelIndicatorType } from "../../../Types/SecurityEvent/ThreatIntelConstants";
import SigmaRuleParser from "../../../Utils/SecurityEvent/Sigma/SigmaRuleParser";
import { getMaxLengthFromTableColumnType } from "../../../Types/Database/ColumnLength";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * WATCHLISTS: THE RULES A LIST AND ITS VALUES KEEP.
 *
 * What the form, the import, the list's page, the API and a rule's runs
 * share: what a list can hold and where its values come from, how a rule
 * names it, which values a list of each kind takes and how each matches,
 * how an import reads a file, and the limits a list keeps - each message in
 * the words the Dashboard translates.
 */

const SHA256: string =
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

describe("what a watchlist holds and where its values come from", () => {
  test("eight kinds, in the form's order, every one an entity type", () => {
    expect([...SECURITY_WATCHLIST_ENTITY_TYPES]).toEqual([
      SecurityEntityType.User,
      SecurityEntityType.Host,
      SecurityEntityType.IpAddress,
      SecurityEntityType.FileHash,
      SecurityEntityType.Domain,
      SecurityEntityType.Url,
      SecurityEntityType.Process,
      SecurityEntityType.Other,
    ]);

    for (const type of SECURITY_WATCHLIST_ENTITY_TYPES) {
      expect(isSecurityWatchlistEntityType(type)).toBe(true);
    }

    expect(isSecurityWatchlistEntityType("Email")).toBe(false);
    expect(isSecurityWatchlistEntityType(undefined)).toBe(false);
    expect(isSecurityWatchlistEntityType(42)).toBe(false);
  });

  test("values the team keeps, or a threat intel feed", () => {
    expect([...SECURITY_WATCHLIST_SOURCES]).toEqual([
      SecurityWatchlistSource.Values,
      SecurityWatchlistSource.ThreatIntelFeed,
    ]);
    expect(isSecurityWatchlistSource("Values")).toBe(true);
    expect(isSecurityWatchlistSource("Threat Intel Feed")).toBe(true);
    expect(isSecurityWatchlistSource("CSV")).toBe(false);
  });

  test("a feed gives addresses, hashes, domains and URLs - the kinds its indicators are", () => {
    expect([...SECURITY_WATCHLIST_FEED_ENTITY_TYPES]).toEqual([
      SecurityEntityType.IpAddress,
      SecurityEntityType.FileHash,
      SecurityEntityType.Domain,
      SecurityEntityType.Url,
    ]);

    expect(
      getSecurityWatchlistFeedIndicatorTypes(SecurityEntityType.IpAddress),
    ).toEqual([
      ThreatIntelIndicatorType.Ipv4Address,
      ThreatIntelIndicatorType.Ipv6Address,
    ]);
    expect(
      getSecurityWatchlistFeedIndicatorTypes(SecurityEntityType.FileHash),
    ).toEqual([
      ThreatIntelIndicatorType.FileHashSha256,
      ThreatIntelIndicatorType.FileHashSha1,
      ThreatIntelIndicatorType.FileHashMd5,
    ]);
    expect(
      getSecurityWatchlistFeedIndicatorTypes(SecurityEntityType.Domain),
    ).toEqual([ThreatIntelIndicatorType.DomainName]);
    expect(
      getSecurityWatchlistFeedIndicatorTypes(SecurityEntityType.Url),
    ).toEqual([ThreatIntelIndicatorType.Url]);
  });

  test("users, hosts, processes and other values have no indicator type: a team keeps them", () => {
    for (const type of [
      SecurityEntityType.User,
      SecurityEntityType.Host,
      SecurityEntityType.Process,
      SecurityEntityType.Other,
    ]) {
      expect(canSecurityWatchlistFollowFeed(type)).toBe(false);
      expect(getSecurityWatchlistFeedIndicatorTypes(type)).toEqual([]);
    }

    expect(canSecurityWatchlistFollowFeed(undefined)).toBe(false);
  });

  test("every indicator type a feed writes reaches a kind of list, and only one", () => {
    const covered: Array<string> = Object.values(
      SECURITY_WATCHLIST_FEED_INDICATOR_TYPES,
    ).flat() as Array<string>;

    expect([...covered].sort()).toEqual(
      Object.values(ThreatIntelIndicatorType)
        .filter((type: string): boolean => {
          // An email address names a sender: no list kind holds one.
          return type !== ThreatIntelIndicatorType.EmailAddress;
        })
        .sort(),
    );
    expect(new Set(covered).size).toBe(covered.length);
  });

  test("the copy a caller gets back is its own", () => {
    const types: Array<string> = getSecurityWatchlistFeedIndicatorTypes(
      SecurityEntityType.IpAddress,
    );
    types.push("tampered");

    expect(
      getSecurityWatchlistFeedIndicatorTypes(SecurityEntityType.IpAddress),
    ).not.toContain("tampered");
  });
});

describe("a watchlist's name: what a rule writes", () => {
  test("a letter, then letters, digits and underscores", () => {
    for (const name of ["vip_users", "VIP_Users", "a", "hosts2", "a_1_b"]) {
      expect(isSecurityWatchlistName(name)).toBe(true);
      expect(getSecurityWatchlistNameProblem(name)).toBeNull();
    }
  });

  test("a hyphen, a space, a dot or a leading digit is refused, saying how a name is written", () => {
    for (const name of [
      "vip-users",
      "vip users",
      "vip.users",
      "1st_list",
      "_hidden",
      "vip%users",
      "списки",
    ]) {
      expect(isSecurityWatchlistName(name)).toBe(false);
      expect(getSecurityWatchlistNameProblem(name)).toBe(
        "Use letters, digits and underscores, starting with a letter, such as vip_users.",
      );
    }
  });

  test("an empty name asks for one, with an example", () => {
    expect(getSecurityWatchlistNameProblem("")).toBe(
      "Enter a name, such as vip_users.",
    );
    expect(getSecurityWatchlistNameProblem("   ")).toBe(
      "Enter a name, such as vip_users.",
    );
    expect(getSecurityWatchlistNameProblem(undefined)).toBe(
      "Enter a name, such as vip_users.",
    );
  });

  test("a name is at most 50 characters, and the message says so", () => {
    expect(SECURITY_WATCHLIST_NAME_MAX_LENGTH).toBe(50);
    expect(isSecurityWatchlistName("a".repeat(50))).toBe(true);
    expect(getSecurityWatchlistNameProblem("a".repeat(51))).toBe(
      "A name is at most 50 characters.",
    );
  });

  test("a name is stored trimmed, and found whatever its case", () => {
    expect(normalizeSecurityWatchlistName("  vip_users ")).toBe("vip_users");
    expect(normalizeSecurityWatchlistName(7)).toBe("");
    expect(getSecurityWatchlistNameKey(" VIP_Users ")).toBe("vip_users");
    expect(getSecurityWatchlistNameKey("vip_users")).toBe(
      getSecurityWatchlistNameKey("VIP_USERS"),
    );
  });

  test("the name column fits the longest name", () => {
    const column: { type: unknown } | undefined =
      new SecurityWatchlist().getTableColumnMetadata("name") as unknown as {
        type: unknown;
      };

    expect(
      getMaxLengthFromTableColumnType(column!.type as never),
    ).toBeGreaterThanOrEqual(SECURITY_WATCHLIST_NAME_MAX_LENGTH);
  });
});

describe("a rule names a list between % signs", () => {
  test("the placeholder a rule writes", () => {
    expect(getSecurityWatchlistPlaceholder("vip_users")).toBe("%vip_users%");
    expect(getSecurityWatchlistPlaceholder(" vip_users ")).toBe("%vip_users%");
  });

  test("a whole value that is a name between % signs names that list", () => {
    expect(readSecurityWatchlistPlaceholder("%vip_users%")).toBe("vip_users");
    expect(readSecurityWatchlistPlaceholder(" %Hosts2% ")).toBe("Hosts2");
  });

  test("anything else names no list", () => {
    for (const value of [
      "vip_users",
      "%vip_users",
      "vip_users%",
      "%%",
      "%",
      "%vip%users%",
      "%vip users%",
      "%1st%",
      "prefix %vip_users%",
      "%vip_users% suffix",
      "",
      null,
      undefined,
      42,
      true,
    ]) {
      expect(readSecurityWatchlistPlaceholder(value)).toBeNull();
    }
  });

  test("the modifier is Sigma's own expand", () => {
    expect(SECURITY_WATCHLIST_MODIFIER).toBe("expand");
  });

  test("a rule that names a missing list is told which, and where lists are made", () => {
    expect(getMissingSecurityWatchlistsMessage(["vip_user"])).toBe(
      "There is no watchlist named vip_user in this project. Create it under Security Events > Detections > Watchlists, or fix its name in the rule.",
    );
    expect(getMissingSecurityWatchlistsMessage(["a", "b"])).toBe(
      "There are no watchlists named a, b in this project. Create them under Security Events > Detections > Watchlists, or fix their names in the rule.",
    );
  });
});

describe("the rule a watchlist's page offers to copy", () => {
  test("each kind with a field of its own matches that field", () => {
    expect(SECURITY_WATCHLIST_SNIPPET_FIELDS).toEqual({
      [SecurityEntityType.User]: "principalUser",
      [SecurityEntityType.Host]: "principalHost",
      [SecurityEntityType.IpAddress]: "principalIp",
      [SecurityEntityType.Process]: "processName",
    });

    expect(getSecurityWatchlistSnippetField(SecurityEntityType.User)).toBe(
      "principalUser",
    );
    expect(getSecurityWatchlistSnippetField(SecurityEntityType.IpAddress)).toBe(
      "principalIp",
    );
  });

  test("hashes, domains, URLs and other values are looked for among the observables", () => {
    expect(SECURITY_WATCHLIST_DEFAULT_SNIPPET_FIELD).toBe("observables");

    for (const type of [
      SecurityEntityType.FileHash,
      SecurityEntityType.Domain,
      SecurityEntityType.Url,
      SecurityEntityType.Other,
      undefined,
      "constructor",
    ]) {
      expect(getSecurityWatchlistSnippetField(type)).toBe("observables");
    }
  });

  test("the snippet is a rule the parser takes, reading the list", () => {
    const snippet: string = getSecurityWatchlistRuleSnippet({
      name: "vip_users",
      entityType: SecurityEntityType.User,
    });

    expect(snippet).toBe(
      [
        "detection:",
        "  selection:",
        "    principalUser|expand: '%vip_users%'",
        "  condition: selection",
      ].join("\n"),
    );

    const rule: ReturnType<typeof SigmaRuleParser.parse> =
      SigmaRuleParser.parse(`title: Uses a list\n${snippet}`);

    expect(rule.selections[0]!.fieldMaps[0]![0]).toEqual({
      field: "principalUser",
      modifiers: ["expand"],
      values: ["%vip_users%"],
    });
  });
});

describe("the values a list takes", () => {
  test("a value is stored trimmed, with no run of wildcards", () => {
    expect(normalizeSecurityWatchlistValue("  svc-** ")).toBe("svc-*");
    expect(normalizeSecurityWatchlistValue("a***b")).toBe("a*b");
    expect(normalizeSecurityWatchlistValue(null)).toBe("");
    expect(getSecurityWatchlistValueKey(" Alice@Example.com ")).toBe(
      "alice@example.com",
    );
    expect(normalizeSecurityWatchlistNote("  why ")).toBe("why");
    expect(normalizeSecurityWatchlistNote(undefined)).toBe("");
  });

  test("any text, for a list of users, hosts, processes or other values", () => {
    for (const type of [
      SecurityEntityType.User,
      SecurityEntityType.Host,
      SecurityEntityType.Process,
      SecurityEntityType.Other,
      SecurityEntityType.Domain,
      SecurityEntityType.Url,
    ]) {
      expect(
        getSecurityWatchlistValueProblem({ value: "svc-*", entityType: type }),
      ).toBeNull();
      expect(
        getSecurityWatchlistValueProblem({
          value: "Mozilla/5.0 (Windows NT 10.0)",
          entityType: type,
        }),
      ).toBeNull();
    }
  });

  test("an empty value, a lone * and a value past 256 characters are refused", () => {
    expect(
      getSecurityWatchlistValueProblem({
        value: " ",
        entityType: SecurityEntityType.User,
      }),
    ).toBe("Enter a value.");
    expect(
      getSecurityWatchlistValueProblem({
        value: "**",
        entityType: SecurityEntityType.User,
      }),
    ).toBe("A value of only * would match everything.");
    expect(SECURITY_WATCHLIST_VALUE_MAX_LENGTH).toBe(256);
    expect(
      getSecurityWatchlistValueProblem({
        value: "a".repeat(256),
        entityType: SecurityEntityType.Other,
      }),
    ).toBeNull();
    expect(
      getSecurityWatchlistValueProblem({
        value: "a".repeat(257),
        entityType: SecurityEntityType.Other,
      }),
    ).toBe("A value is at most 256 characters.");
  });

  test("a value is one line: a tab or a line break inside it is refused", () => {
    for (const value of ["a\tb", "a\nb", "a\rb", "a\u0000b", "a\u007fb"]) {
      expect(
        getSecurityWatchlistValueProblem({
          value,
          entityType: SecurityEntityType.Other,
        }),
      ).toBe("A value is one line, without tabs.");
    }
  });

  test("an IP address list takes addresses, ranges and patterns, and nothing else", () => {
    for (const value of [
      "203.0.113.7",
      "2001:db8::7",
      "10.20.0.0/16",
      "2001:db8::/32",
      "10.20.*",
    ]) {
      expect(
        getSecurityWatchlistValueProblem({
          value,
          entityType: SecurityEntityType.IpAddress,
        }),
      ).toBeNull();
    }

    for (const value of [
      "not-an-address",
      "10.20.0.0/33",
      "300.1.1.1",
      "10.20.0.0/",
    ]) {
      expect(
        getSecurityWatchlistValueProblem({
          value,
          entityType: SecurityEntityType.IpAddress,
        }),
      ).toBe(
        "Enter an IP address, a range such as 10.20.0.0/16, or a pattern with *.",
      );
    }
  });

  test("a file hash list takes MD5, SHA-1, SHA-256 and SHA-512 digests, in either case", () => {
    for (const value of [
      "d41d8cd98f00b204e9800998ecf8427e",
      "da39a3ee5e6b4b0d3255bfef95601890afd80709",
      SHA256,
      SHA256.toUpperCase(),
      "a".repeat(128),
    ]) {
      expect(
        getSecurityWatchlistValueProblem({
          value,
          entityType: SecurityEntityType.FileHash,
        }),
      ).toBeNull();
    }

    for (const value of ["abc", "z".repeat(64), `${SHA256}0`, "d41d8*"]) {
      expect(
        getSecurityWatchlistValueProblem({
          value,
          entityType: SecurityEntityType.FileHash,
        }),
      ).toBe("Enter an MD5, SHA-1, SHA-256 or SHA-512 hash.");
    }
  });

  test("a note is at most 500 characters", () => {
    expect(SECURITY_WATCHLIST_NOTE_MAX_LENGTH).toBe(500);
    expect(getSecurityWatchlistNoteProblem("a".repeat(500))).toBeNull();
    expect(getSecurityWatchlistNoteProblem(undefined)).toBeNull();
    expect(getSecurityWatchlistNoteProblem("a".repeat(501))).toBe(
      "A note is at most 500 characters.",
    );
  });

  test("the value and note columns hold the longest value and note", () => {
    const item: SecurityWatchlistItem = new SecurityWatchlistItem();

    for (const [column, max] of [
      ["value", SECURITY_WATCHLIST_VALUE_MAX_LENGTH],
      ["note", SECURITY_WATCHLIST_NOTE_MAX_LENGTH],
    ] as Array<[string, number]>) {
      const metadata: { type: unknown } = item.getTableColumnMetadata(
        column,
      ) as unknown as { type: unknown };

      expect(
        getMaxLengthFromTableColumnType(metadata.type as never),
      ).toBeGreaterThanOrEqual(max);
    }

    const description: { type: unknown } =
      new SecurityWatchlist().getTableColumnMetadata(
        "description",
      ) as unknown as { type: unknown };

    expect(
      getMaxLengthFromTableColumnType(description.type as never),
    ).toBeGreaterThanOrEqual(SECURITY_WATCHLIST_DESCRIPTION_MAX_LENGTH);
  });
});

describe("how each value matches", () => {
  test("a range in an IP address list, a pattern with *, or as written", () => {
    expect(
      getSecurityWatchlistValueMatch({
        value: "10.20.0.0/16",
        entityType: SecurityEntityType.IpAddress,
      }),
    ).toBe(SecurityWatchlistValueMatch.Range);
    expect(
      getSecurityWatchlistValueMatch({
        value: "10.20.*",
        entityType: SecurityEntityType.IpAddress,
      }),
    ).toBe(SecurityWatchlistValueMatch.Pattern);
    expect(
      getSecurityWatchlistValueMatch({
        value: "203.0.113.7",
        entityType: SecurityEntityType.IpAddress,
      }),
    ).toBe(SecurityWatchlistValueMatch.Exact);
    expect(
      getSecurityWatchlistValueMatch({
        value: "svc-*",
        entityType: SecurityEntityType.User,
      }),
    ).toBe(SecurityWatchlistValueMatch.Pattern);
  });

  test("a slash in a user is a character, never a range", () => {
    expect(
      getSecurityWatchlistValueMatch({
        value: "corp/alice",
        entityType: SecurityEntityType.User,
      }),
    ).toBe(SecurityWatchlistValueMatch.Exact);
    expect(
      getSecurityWatchlistValueMatch({
        value: "10.0.0.0/8",
        entityType: SecurityEntityType.Other,
      }),
    ).toBe(SecurityWatchlistValueMatch.Exact);
  });

  test("a run reads the values split by how they match, lowercased, each once", () => {
    expect(
      splitSecurityWatchlistValues({
        values: [
          "203.0.113.7",
          "10.20.0.0/16",
          "10.30.*",
          "2001:DB8::7",
          "203.0.113.7",
          "*",
          "",
          "10.20.0.0/16",
          "10.30.*",
        ],
        entityType: SecurityEntityType.IpAddress,
      }),
    ).toEqual({
      exactValues: ["203.0.113.7", "2001:db8::7"],
      patterns: ["10.30.*"],
      ranges: ["10.20.0.0/16"],
    });

    expect(
      splitSecurityWatchlistValues({
        values: ["Alice", "alice", "SVC-*", "Bob"],
        entityType: SecurityEntityType.User,
      }),
    ).toEqual({
      exactValues: ["alice", "bob"],
      patterns: ["svc-*"],
      ranges: [],
    });
  });

  test("a pattern matches piece by piece, whatever the case", () => {
    expect(matchesSecurityWatchlistPattern("svc-*", "SVC-backup")).toBe(true);
    expect(
      matchesSecurityWatchlistPattern("*.corp.example", "db.corp.example"),
    ).toBe(true);
    expect(matchesSecurityWatchlistPattern("a*b*c", "aXbYc")).toBe(true);
    expect(matchesSecurityWatchlistPattern("a*b*c", "aXcYb")).toBe(false);
    expect(matchesSecurityWatchlistPattern("ab*ba", "aba")).toBe(false);
    expect(matchesSecurityWatchlistPattern("alice", "Alice ")).toBe(true);
    expect(matchesSecurityWatchlistPattern("alice", "alicex")).toBe(false);
    expect(matchesSecurityWatchlistPattern("", "x")).toBe(false);
    expect(matchesSecurityWatchlistPattern("x", "")).toBe(false);
  });

  test("a pattern on a long value takes time in line with its length", () => {
    const timed: FastestRun<boolean> = fastestRun({
      run: (): boolean => {
        // A new text each attempt, so every attempt does the whole work.
        return matchesSecurityWatchlistPattern(
          "*a*a*a*a*c",
          `${"a".repeat(400_000)}b`,
        );
      },
      limitInMs: 2000,
    });

    expect(timed.result).toBe(false);
    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("a list's limits", () => {
  test("5,000 values, 100 of them patterns and 100 ranges", () => {
    expect(SECURITY_WATCHLIST_VALUES_MAX).toBe(5000);
    expect(SECURITY_WATCHLIST_PATTERN_VALUES_MAX).toBe(100);
    expect(SECURITY_WATCHLIST_RANGE_VALUES_MAX).toBe(100);
    expect(SECURITY_WATCHLISTS_PER_PROJECT_MAX).toBe(200);
  });

  test("values are counted by how they match", () => {
    expect(
      countSecurityWatchlistValues({
        values: ["10.0.0.0/8", "10.1.*", "10.2.3.4", "10.3.0.0/16"],
        entityType: SecurityEntityType.IpAddress,
      }),
    ).toEqual({ total: 4, patterns: 1, ranges: 2 });
  });

  test("a list past a limit is refused, each in its own words", () => {
    expect(
      getSecurityWatchlistSizeProblem({
        total: 5000,
        patterns: 100,
        ranges: 100,
      }),
    ).toBeNull();
    expect(
      getSecurityWatchlistSizeProblem({ total: 5001, patterns: 0, ranges: 0 }),
    ).toBe(
      "A watchlist holds at most 5,000 values. Follow a threat intel feed for a longer list.",
    );
    expect(
      getSecurityWatchlistSizeProblem({ total: 200, patterns: 101, ranges: 0 }),
    ).toBe("A watchlist holds at most 100 values with *.");
    expect(
      getSecurityWatchlistSizeProblem({ total: 200, patterns: 0, ranges: 101 }),
    ).toBe("A watchlist holds at most 100 address ranges.");
  });
});

describe("what is wrong with a watchlist, field by field", () => {
  const valid: {
    name: string;
    entityType: SecurityEntityType;
    source: SecurityWatchlistSource;
  } = {
    name: "vip_users",
    entityType: SecurityEntityType.User,
    source: SecurityWatchlistSource.Values,
  };

  test("a list kept by hand needs a name and what it holds", () => {
    expect(getSecurityWatchlistProblems(valid)).toEqual([]);
    expect(getSecurityWatchlistProblem(valid)).toBeNull();
    // A list with no source said is kept by hand.
    expect(
      getSecurityWatchlistProblems({ name: "a", entityType: "User" }),
    ).toEqual([]);
  });

  test("every missing field is named, in the form's order", () => {
    expect(getSecurityWatchlistProblems({})).toEqual([
      { field: "name", message: "Enter a name, such as vip_users." },
      { field: "entityType", message: "Choose what the watchlist holds." },
    ]);
  });

  test("a description past 500 characters is refused", () => {
    expect(
      getSecurityWatchlistProblem({
        ...valid,
        description: "a".repeat(501),
      }),
    ).toBe("A description is at most 500 characters.");
  });

  test("a source that is neither is refused", () => {
    expect(getSecurityWatchlistProblems({ ...valid, source: "CSV" })).toEqual([
      { field: "source", message: "Choose where the values come from." },
    ]);
  });

  test("a list that follows a feed names the feed, and holds a kind a feed carries", () => {
    expect(
      getSecurityWatchlistProblems({
        name: "tor_exits",
        entityType: SecurityEntityType.IpAddress,
        source: SecurityWatchlistSource.ThreatIntelFeed,
        threatIntelFeedId: "0b9d2c42-6f0b-4b47-9f39-6e8b1a2f6d11",
      }),
    ).toEqual([]);

    const problems: Array<SecurityWatchlistProblem> =
      getSecurityWatchlistProblems({
        name: "vip_users",
        entityType: SecurityEntityType.User,
        source: SecurityWatchlistSource.ThreatIntelFeed,
      });

    expect(problems).toEqual([
      {
        field: "source",
        message:
          "A threat intel feed carries IP addresses, file hashes, domains and URLs. Keep a list of anything else by hand.",
      },
      {
        field: "threatIntelFeedId",
        message: "Choose the threat intel feed to follow.",
      },
    ]);
  });
});

describe("importing values: one a line, a note after a comma or a tab", () => {
  test("one value a line", () => {
    const result: SecurityWatchlistImportResult = parseSecurityWatchlistImport({
      text: "alice@example.com\nbob@example.com\n",
      entityType: SecurityEntityType.User,
    });

    expect(result).toEqual({
      values: [
        { value: "alice@example.com", note: "" },
        { value: "bob@example.com", note: "" },
      ],
      problems: [],
      duplicates: 0,
    });
  });

  test("a two-column CSV with a header: the value, then its note", () => {
    const result: SecurityWatchlistImportResult = parseSecurityWatchlistImport({
      text: 'value,note\r\nalice@example.com,CFO\r\n"doe, john",Board member\r\n',
      entityType: SecurityEntityType.User,
    });

    expect(result.values).toEqual([
      { value: "alice@example.com", note: "CFO" },
      { value: "doe, john", note: "Board member" },
    ]);
    expect(result.problems).toEqual([]);
  });

  test("a tab-separated file reads the same", () => {
    expect(
      parseSecurityWatchlistImport({
        text: "web-01\tPayments\nweb-02\tCheckout",
        entityType: SecurityEntityType.Host,
      }).values,
    ).toEqual([
      { value: "web-01", note: "Payments" },
      { value: "web-02", note: "Checkout" },
    ]);
  });

  test("empty lines and # comments are skipped, and a header only on the first line", () => {
    const result: SecurityWatchlistImportResult = parseSecurityWatchlistImport({
      text: "\n# VIPs, kept by the security team\nValue\nvalue\n\nalice\n",
      entityType: SecurityEntityType.User,
    });

    // "Value" is the header; the second "value" is a user called value.
    expect(result.values).toEqual([
      { value: "value", note: "" },
      { value: "alice", note: "" },
    ]);
  });

  test("a value repeated, whatever its case, is kept once and counted", () => {
    const result: SecurityWatchlistImportResult = parseSecurityWatchlistImport({
      text: "Alice\nalice\nALICE,again\nbob",
      entityType: SecurityEntityType.User,
    });

    expect(result.values).toEqual([
      { value: "Alice", note: "" },
      { value: "bob", note: "" },
    ]);
    expect(result.duplicates).toBe(2);
  });

  test("lines that are not values of the list are left out, each with its line and why", () => {
    const result: SecurityWatchlistImportResult = parseSecurityWatchlistImport({
      text: `10.20.0.0/16\nnot-an-address\n203.0.113.7\n*\n10.0.0.1,${"n".repeat(501)}`,
      entityType: SecurityEntityType.IpAddress,
    });

    expect(result.values).toEqual([
      { value: "10.20.0.0/16", note: "" },
      { value: "203.0.113.7", note: "" },
    ]);
    expect(result.problems).toEqual([
      {
        line: 2,
        value: "not-an-address",
        message:
          "Enter an IP address, a range such as 10.20.0.0/16, or a pattern with *.",
      },
      {
        line: 4,
        value: "*",
        message: "A value of only * would match everything.",
      },
      {
        line: 5,
        value: "10.0.0.1",
        message: "A note is at most 500 characters.",
      },
    ]);
  });

  test("quotes: a quoted value keeps its commas, and a doubled quote is one", () => {
    expect(readSecurityWatchlistImportLine('"a, ""b""",note')).toEqual({
      value: 'a, "b"',
      note: "note",
    });
    expect(
      readSecurityWatchlistImportLine('alice,"a note, with a comma"'),
    ).toEqual({ value: "alice", note: "a note, with a comma" });
    expect(readSecurityWatchlistImportLine("solo")).toEqual({
      value: "solo",
      note: "",
    });
    expect(readSecurityWatchlistImportLine("a,b,c")).toEqual({
      value: "a",
      note: "b,c",
    });
  });

  test("nothing to read is nothing", () => {
    expect(
      parseSecurityWatchlistImport({
        text: "",
        entityType: SecurityEntityType.User,
      }),
    ).toEqual({ values: [], problems: [], duplicates: 0 });
  });

  test("a long file is read in time in line with its length", () => {
    const lines: Array<string> = [];

    for (let index: number = 0; index < 5000; index++) {
      lines.push(`"user-${index}, ${"x".repeat(150)}",${"y".repeat(400)}`);
    }

    const timed: FastestRun<SecurityWatchlistImportResult> = fastestRun({
      run: (): SecurityWatchlistImportResult => {
        return parseSecurityWatchlistImport({
          text: lines.join("\n"),
          entityType: SecurityEntityType.User,
        });
      },
      limitInMs: 2000,
    });

    expect(timed.result.values).toHaveLength(5000);
    expect(timed.inMs).toBeLessThan(2000);
    expect(SECURITY_WATCHLIST_IMPORT_MAX_CHARACTERS).toBe(4 * 1024 * 1024);
  });

  test("an import adds to a list, or replaces it", () => {
    expect(isSecurityWatchlistImportMode(SecurityWatchlistImportMode.Add)).toBe(
      true,
    );
    expect(isSecurityWatchlistImportMode("replace")).toBe(true);
    expect(isSecurityWatchlistImportMode("merge")).toBe(false);
  });
});
