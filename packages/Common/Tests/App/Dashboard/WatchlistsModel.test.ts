import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  FEED_GONE,
  FOLLOWS_A_FEED,
  HOLDS_DOMAINS,
  HOLDS_FILE_HASHES,
  HOLDS_HOSTS,
  HOLDS_IP_ADDRESSES,
  HOLDS_OTHER,
  HOLDS_PROCESSES,
  HOLDS_URLS,
  HOLDS_USERS,
  NO_VALUES_YET,
  READ_BY_NO_RULE,
  VALUES_TABLE_DESCRIPTION,
  VALUES_TABLE_DESCRIPTION_HASH,
  VALUES_TABLE_DESCRIPTION_IP,
  VALUE_FIELD_DESCRIPTION,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Watchlists/WatchlistsCopy";
import {
  WATCHLIST_IMPORT_PROBLEMS_SHOWN,
  WATCHLIST_READERS_SHOWN,
  WATCHLIST_STARTERS,
  WatchlistStarter,
  canChooseWatchlistSource,
  describeWatchlistImportPreview,
  describeWatchlistReaders,
  describeWatchlistValues,
  getAvailableWatchlistStarters,
  getWatchlistHoldsIcon,
  getWatchlistHoldsKey,
  getWatchlistHoldsLabel,
  getWatchlistHoldsOptions,
  getWatchlistReaders,
  getWatchlistValuesHint,
  isFeedWatchlist,
  splitWatchlistName,
  summarizeWatchlistReaders,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Watchlists/WatchlistsModel";
import IconProp from "../../../Types/Icon/IconProp";
import {
  SecurityEntityType,
  getSecurityEntityIcon,
} from "../../../Types/SecurityCase/SecurityEntity";
import {
  SECURITY_WATCHLIST_ENTITY_TYPES,
  SECURITY_WATCHLIST_NAME_MAX_LENGTH,
  SecurityWatchlistSource,
  getSecurityWatchlistNameProblem,
  getSecurityWatchlistProblems,
  getSecurityWatchlistValueProblem,
  parseSecurityWatchlistImport,
} from "../../../Types/SecurityEvent/SecurityWatchlist";
import { getRulesReadingWatchlists } from "../../../Utils/SecurityEvent/Sigma/SigmaWatchlists";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * WHAT THE WATCHLISTS PAGES SAY ABOUT A LIST, worked out without React:
 * what it holds, in words and as an icon; its values - how many it keeps,
 * or the feed it follows; the rules that read it; the common lists a
 * project is offered to start with; and what an import is about to do -
 * in English, and in the reader's language from the Dashboard's own
 * locale files.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");

function localeTranslator(language: string): Translator {
  const words: Record<string, string> = JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        `../../../../App/FeatureSet/Dashboard/src/Locales/${language}.json`,
      ),
      "utf8",
    ),
  ) as Record<string, string>;

  return createTranslator((key: string): string | undefined => {
    return words[key];
  }, language);
}

const GERMAN: Translator = localeTranslator("de");
const RUSSIAN: Translator = localeTranslator("ru");

describe("how a list's values match, in its kind's words", () => {
  test("a user list shows a pattern at work, an IP address list its ranges, a file hash list the digests it takes", () => {
    expect(getWatchlistValuesHint(SecurityEntityType.User)).toBe(
      VALUES_TABLE_DESCRIPTION,
    );
    expect(getWatchlistValuesHint(SecurityEntityType.IpAddress)).toBe(
      VALUES_TABLE_DESCRIPTION_IP,
    );
    expect(getWatchlistValuesHint(SecurityEntityType.FileHash)).toBe(
      VALUES_TABLE_DESCRIPTION_HASH,
    );

    // Every other kind: whatever the case, * for any run of characters - no user's example.
    for (const type of [
      SecurityEntityType.Host,
      SecurityEntityType.Domain,
      SecurityEntityType.Url,
      SecurityEntityType.Process,
      SecurityEntityType.Other,
      "Spaceship",
      undefined,
    ]) {
      expect({ type, hint: getWatchlistValuesHint(type) }).toEqual({
        type,
        hint: VALUE_FIELD_DESCRIPTION,
      });
    }
  });

  test("each kind's words say only what its values may be: a hash list's never a pattern", () => {
    // svc-* is a user's example: only a user list says it.
    for (const type of SECURITY_WATCHLIST_ENTITY_TYPES) {
      expect({
        type,
        says: getWatchlistValuesHint(type).includes("svc-*"),
      }).toEqual({ type, says: type === SecurityEntityType.User });
    }

    // A hash list takes no *, as the shared rules refuse one.
    expect(VALUES_TABLE_DESCRIPTION_HASH).not.toContain("*");
    expect(
      getSecurityWatchlistValueProblem({
        value: "44d88612fea8a8f36de82e1278abb0*",
        entityType: SecurityEntityType.FileHash,
      }),
    ).not.toBeNull();
    for (const digest of ["MD5", "SHA-1", "SHA-256", "SHA-512"]) {
      expect(VALUES_TABLE_DESCRIPTION_HASH).toContain(digest);
    }
  });

  test("in German, from the Dashboard's own words", () => {
    expect(
      GERMAN.translateText(getWatchlistValuesHint(SecurityEntityType.FileHash)),
    ).toBe(
      "MD5-, SHA-1-, SHA-256- und SHA-512-Hashes. Groß- und Kleinschreibung zählt nicht.",
    );
  });
});

describe("a long list name", () => {
  test("may break after each underscore, and its parts join back to the name", () => {
    const name: string = "executive_assistants_and_finance_admin_accounts";

    expect(splitWatchlistName(name)).toEqual([
      "executive_",
      "assistants_",
      "and_",
      "finance_",
      "admin_",
      "accounts",
    ]);
    expect(splitWatchlistName(name).join("")).toBe(name);
  });

  test("a short name stays whole, as other short names do", () => {
    expect(splitWatchlistName("vip_users")).toEqual(["vip_users"]);
    expect(splitWatchlistName("known_bad_hashes")).toEqual([
      "known_bad_hashes",
    ]);
  });

  test("the longest name a rule can write breaks into parts, the last one whole", () => {
    const longest: string = `a${"_b".repeat(
      (SECURITY_WATCHLIST_NAME_MAX_LENGTH - 1) / 2,
    )}`.slice(0, SECURITY_WATCHLIST_NAME_MAX_LENGTH);

    expect(getSecurityWatchlistNameProblem(longest)).toBeNull();

    const parts: Array<string> = splitWatchlistName(longest);

    expect(parts.join("")).toBe(longest);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts.slice(0, -1)) {
      expect(part.endsWith("_")).toBe(true);
    }
  });

  test("a name with no underscore has nowhere of its own to break", () => {
    expect(splitWatchlistName("x".repeat(40))).toEqual(["x".repeat(40)]);
  });
});

describe("what a list holds", () => {
  test("each kind has its own plural words, in the form's order", () => {
    expect(
      SECURITY_WATCHLIST_ENTITY_TYPES.map((type: SecurityEntityType) => {
        return getWatchlistHoldsKey(type);
      }),
    ).toEqual([
      HOLDS_USERS,
      HOLDS_HOSTS,
      HOLDS_IP_ADDRESSES,
      HOLDS_FILE_HASHES,
      HOLDS_DOMAINS,
      HOLDS_URLS,
      HOLDS_PROCESSES,
      HOLDS_OTHER,
    ]);
    expect([HOLDS_USERS, HOLDS_IP_ADDRESSES, HOLDS_OTHER]).toEqual([
      "Users",
      "IP addresses",
      "Other values",
    ]);
  });

  test("a kind this version does not know reads as Other values, never as stored", () => {
    expect(getWatchlistHoldsKey("Spaceship")).toBe(HOLDS_OTHER);
    expect(getWatchlistHoldsKey(undefined)).toBe(HOLDS_OTHER);
    expect(getWatchlistHoldsKey("toString")).toBe(HOLDS_OTHER);
    expect(getWatchlistHoldsLabel(ENGLISH, 42)).toBe("Other values");
  });

  test("its words are the reader's", () => {
    expect(getWatchlistHoldsLabel(ENGLISH, SecurityEntityType.FileHash)).toBe(
      "File hashes",
    );
    expect(getWatchlistHoldsLabel(GERMAN, SecurityEntityType.FileHash)).toBe(
      "Datei-Hashes",
    );
    expect(getWatchlistHoldsLabel(GERMAN, SecurityEntityType.IpAddress)).toBe(
      "IP-Adressen",
    );
  });

  test("its icon is its kind's entity icon; an unknown kind a list's", () => {
    for (const type of SECURITY_WATCHLIST_ENTITY_TYPES) {
      expect(getWatchlistHoldsIcon(type)).toBe(getSecurityEntityIcon(type));
    }

    expect(getWatchlistHoldsIcon("Spaceship")).toBe(IconProp.QueueList);
    expect(getWatchlistHoldsIcon(undefined)).toBe(IconProp.QueueList);
  });

  test("the Holds dropdown offers every kind, labelled by its English key", () => {
    expect(getWatchlistHoldsOptions()).toEqual(
      SECURITY_WATCHLIST_ENTITY_TYPES.map((type: SecurityEntityType) => {
        return { value: type, label: getWatchlistHoldsKey(type) };
      }),
    );
  });

  test("only a kind a threat intel feed carries may follow one", () => {
    expect(
      SECURITY_WATCHLIST_ENTITY_TYPES.filter((type: SecurityEntityType) => {
        return canChooseWatchlistSource(type);
      }),
    ).toEqual([
      SecurityEntityType.IpAddress,
      SecurityEntityType.FileHash,
      SecurityEntityType.Domain,
      SecurityEntityType.Url,
    ]);
    expect(canChooseWatchlistSource(undefined)).toBe(false);
  });

  test("a list follows a feed only when its source says so", () => {
    expect(isFeedWatchlist(SecurityWatchlistSource.ThreatIntelFeed)).toBe(true);
    expect(isFeedWatchlist(SecurityWatchlistSource.Values)).toBe(false);
    expect(isFeedWatchlist(undefined)).toBe(false);
  });
});

describe("a list's values, as a row says them", () => {
  test("how many a list keeps, one and many, written the reader's way", () => {
    expect(
      describeWatchlistValues(ENGLISH, {
        source: SecurityWatchlistSource.Values,
        valueCount: 1,
      }),
    ).toBe("1 value");
    expect(
      describeWatchlistValues(ENGLISH, {
        source: SecurityWatchlistSource.Values,
        valueCount: 4321,
      }),
    ).toBe("4,321 values");
    expect(
      describeWatchlistValues(GERMAN, {
        source: SecurityWatchlistSource.Values,
        valueCount: 1,
      }),
    ).toBe("1 Wert");
    expect(
      describeWatchlistValues(GERMAN, {
        source: SecurityWatchlistSource.Values,
        valueCount: 4321,
      }),
    ).toBe("4.321 Werte");
  });

  test("Russian says 21 in its one form and 3 in its general one", () => {
    expect(
      describeWatchlistValues(RUSSIAN, {
        source: SecurityWatchlistSource.Values,
        valueCount: 21,
      }),
    ).toBe("21 значение");
    expect(
      describeWatchlistValues(RUSSIAN, {
        source: SecurityWatchlistSource.Values,
        valueCount: 3,
      }),
    ).toBe("Значений: 3");
  });

  test("a list with no values says so, whatever its count reads", () => {
    for (const valueCount of [0, undefined, -2, Number.NaN]) {
      expect(
        describeWatchlistValues(ENGLISH, {
          source: SecurityWatchlistSource.Values,
          valueCount,
        }),
      ).toBe(NO_VALUES_YET);
    }

    // No source stored is a list kept by hand.
    expect(describeWatchlistValues(ENGLISH, { valueCount: 2 })).toBe(
      "2 values",
    );
  });

  test("a list that follows a feed names the feed, as written, never a count", () => {
    expect(
      describeWatchlistValues(ENGLISH, {
        source: SecurityWatchlistSource.ThreatIntelFeed,
        valueCount: 12,
        threatIntelFeedId: "feed-1",
        feedName: "  Tor exit nodes ",
      }),
    ).toBe("Follows Tor exit nodes");
    expect(
      describeWatchlistValues(GERMAN, {
        source: SecurityWatchlistSource.ThreatIntelFeed,
        threatIntelFeedId: "feed-1",
        feedName: "Tor exit nodes",
      }),
    ).toBe("Folgt Tor exit nodes");
  });

  test("a feed not read by name is a feed; a feed that is gone says so", () => {
    expect(
      describeWatchlistValues(ENGLISH, {
        source: SecurityWatchlistSource.ThreatIntelFeed,
        threatIntelFeedId: "feed-1",
      }),
    ).toBe(FOLLOWS_A_FEED);
    expect(
      describeWatchlistValues(ENGLISH, {
        source: SecurityWatchlistSource.ThreatIntelFeed,
        threatIntelFeedId: null,
        feedName: "Tor exit nodes",
      }),
    ).toBe(FEED_GONE);
    expect(
      describeWatchlistValues(GERMAN, {
        source: SecurityWatchlistSource.ThreatIntelFeed,
      }),
    ).toBe("Sein Threat-Intel-Feed wurde gelöscht");
  });
});

describe("the rules that read a list", () => {
  const RULES: Array<{ id: string; name: string }> = [
    { id: "r1", name: "VIP sign-in from a new country" },
    { id: "r2", name: "VIP MFA reset" },
    { id: "r3", name: "VIP mailbox rule" },
    { id: "r4", name: "VIP token theft" },
  ];

  test("the first two by name, then how many more", () => {
    expect(WATCHLIST_READERS_SHOWN).toBe(2);
    expect(summarizeWatchlistReaders(RULES)).toEqual({
      names: ["VIP sign-in from a new country", "VIP MFA reset"],
      more: 2,
    });
    expect(summarizeWatchlistReaders(RULES.slice(0, 2))).toEqual({
      names: ["VIP sign-in from a new country", "VIP MFA reset"],
      more: 0,
    });
    expect(summarizeWatchlistReaders(undefined)).toEqual({
      names: [],
      more: 0,
    });
  });

  test("in words: names, and more in the reader's language", () => {
    expect(
      describeWatchlistReaders(ENGLISH, summarizeWatchlistReaders(RULES)),
    ).toBe("VIP sign-in from a new country, VIP MFA reset and 2 more");
    expect(
      describeWatchlistReaders(
        ENGLISH,
        summarizeWatchlistReaders(RULES.slice(0, 1)),
      ),
    ).toBe("VIP sign-in from a new country");
    expect(
      describeWatchlistReaders(GERMAN, summarizeWatchlistReaders(RULES)),
    ).toBe("VIP sign-in from a new country, VIP MFA reset und 2 weitere");
  });

  test("a list no rule reads says so", () => {
    expect(
      describeWatchlistReaders(ENGLISH, summarizeWatchlistReaders([])),
    ).toBe(READ_BY_NO_RULE);
    expect(describeWatchlistReaders(GERMAN, { names: [], more: 0 })).toBe(
      "Noch liest keine Regel sie",
    );
  });

  test("a list's readers are found by its name, whatever the case", () => {
    const readers: Map<
      string,
      Array<{ id: string; name: string }>
    > = getRulesReadingWatchlists([
      {
        id: "r1",
        name: "VIP sign-in",
        sigmaRuleYaml: [
          "title: VIP sign-in",
          "logsource:",
          "  product: okta",
          "detection:",
          "  selection:",
          "    principalUser|expand: '%VIP_Users%'",
          "  condition: selection",
        ].join("\n"),
      },
      {
        id: "r2",
        name: "Brute force",
        sigmaRuleYaml: [
          "title: Brute force",
          "logsource:",
          "  product: okta",
          "detection:",
          "  selection:",
          "    outcome: failure",
          "  condition: selection",
        ].join("\n"),
      },
    ]);

    expect(getWatchlistReaders(readers, "vip_users")).toEqual([
      { id: "r1", name: "VIP sign-in" },
    ]);
    expect(getWatchlistReaders(readers, "critical_hosts")).toEqual([]);
    expect(getWatchlistReaders(readers, undefined)).toEqual([]);
  });
});

describe("the common lists to start with", () => {
  test("four, each a name rules can write, a kind and a description", () => {
    expect(
      WATCHLIST_STARTERS.map((starter: WatchlistStarter) => {
        return [starter.name, starter.entityType];
      }),
    ).toEqual([
      ["vip_users", SecurityEntityType.User],
      ["critical_hosts", SecurityEntityType.Host],
      ["known_bad_hashes", SecurityEntityType.FileHash],
      ["admin_addresses", SecurityEntityType.IpAddress],
    ]);

    for (const starter of WATCHLIST_STARTERS) {
      expect(getSecurityWatchlistNameProblem(starter.name)).toBeNull();
      expect(
        getSecurityWatchlistProblems({
          name: starter.name,
          entityType: starter.entityType,
          description: starter.description,
          source: SecurityWatchlistSource.Values,
        }),
      ).toEqual([]);
      expect(starter.icon).toBe(getSecurityEntityIcon(starter.entityType));
      expect(GERMAN.translateText(starter.title)).not.toBe(starter.title);
      expect(GERMAN.translateText(starter.description)).not.toBe(
        starter.description,
      );
    }

    expect(
      new Set(
        WATCHLIST_STARTERS.map((starter: WatchlistStarter) => {
          return starter.key;
        }),
      ).size,
    ).toBe(WATCHLIST_STARTERS.length);
  });

  test("a project is offered only the ones it does not have, by name whatever the case", () => {
    expect(getAvailableWatchlistStarters([])).toEqual(WATCHLIST_STARTERS);
    expect(
      getAvailableWatchlistStarters(["VIP_USERS", "known_bad_hashes", "x"]).map(
        (starter: WatchlistStarter) => {
          return starter.name;
        },
      ),
    ).toEqual(["critical_hosts", "admin_addresses"]);
    expect(
      getAvailableWatchlistStarters(
        WATCHLIST_STARTERS.map((starter: WatchlistStarter) => {
          return starter.name;
        }),
      ),
    ).toEqual([]);
  });
});

describe("what an import is about to do", () => {
  test("how many values, the repeated lines it skips, the lines it leaves out", () => {
    const text: string = [
      "value,note",
      "alice@example.com, CFO",
      "ALICE@example.com",
      "bob@example.com",
      "*",
      "",
      "# the board",
      "carol@example.com",
    ].join("\n");

    const preview: Array<string> = describeWatchlistImportPreview(
      ENGLISH,
      parseSecurityWatchlistImport({
        text,
        entityType: SecurityEntityType.User,
      }),
    );

    expect(preview).toEqual([
      "3 values to import",
      "1 repeated line skipped",
      "1 line left out",
    ]);
  });

  test("a clean import says only how many values, in the reader's words", () => {
    const result: ReturnType<typeof parseSecurityWatchlistImport> =
      parseSecurityWatchlistImport({
        text: "10.0.0.1\n10.20.0.0/16\n",
        entityType: SecurityEntityType.IpAddress,
      });

    expect(describeWatchlistImportPreview(ENGLISH, result)).toEqual([
      "2 values to import",
    ]);
    expect(describeWatchlistImportPreview(GERMAN, result)).toEqual([
      "2 Werte zum Importieren",
    ]);
  });

  test("an empty import has nothing to import", () => {
    expect(
      describeWatchlistImportPreview(
        ENGLISH,
        parseSecurityWatchlistImport({
          text: "",
          entityType: SecurityEntityType.User,
        }),
      ),
    ).toEqual(["0 values to import"]);
  });

  test("the preview names five lines it leaves out, and counts the rest", () => {
    expect(WATCHLIST_IMPORT_PROBLEMS_SHOWN).toBe(5);
  });
});
