/*
 * Watchlists on the fixture's synthetic month: the lists Security Events >
 * Detections > Watchlists shows, each list's values, the rule that reads
 * two of them, and what POST /security-watchlist/import answers.
 *
 *   vip_users         Users, kept by hand: the CEO, the CFO and the
 *                     finance admins' accounts (a pattern with *)
 *   admin_addresses   IP addresses, kept by hand: the office range, the
 *                     VPN's address and the bastion hosts' range
 *   c2_addresses      IP addresses, following the Feodo Tracker list
 *   lab_hosts         Hosts, kept by hand, with no values yet
 *
 * So the common lists still offered are Critical hosts and Known-bad file
 * hashes. "VIP sign-in from outside the office" (off, while it is tuned)
 * reads vip_users and admin_addresses; no rule reads the other two.
 *
 * The server's own bookkeeping is kept as the server keeps it: a list's
 * valueCount follows its values as they are added, imported and deleted,
 * and a list's values go with it. An import reads its text with the
 * shared reader the server uses (parseSecurityWatchlistImport), adds to the
 * list or replaces it, and answers what it did.
 */
import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import SecurityWatchlist from "Common/Models/DatabaseModels/SecurityWatchlist";
import SecurityWatchlistItem from "Common/Models/DatabaseModels/SecurityWatchlistItem";
import ThreatIntelFeed from "Common/Models/DatabaseModels/ThreatIntelFeed";
import { SecurityEntityType } from "Common/Types/SecurityCase/SecurityEntity";
import {
  SecurityWatchlistImportMode,
  SecurityWatchlistSource,
  getSecurityWatchlistValueKey,
  normalizeSecurityWatchlistValue,
  parseSecurityWatchlistImport,
} from "Common/Types/SecurityEvent/SecurityWatchlist";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// The lines an import's answer names, at most (SECURITY_WATCHLIST_IMPORT_PROBLEMS_SHOWN).
const PROBLEMS_SHOWN = 20;

export const WATCHLIST_READING_RULE = "VIP sign-in from outside the office";

const WATCHLIST_READING_RULE_YAML = `title: VIP sign-in from outside the office
level: high
detection:
  vip_sign_in:
    className: Authentication
    statusName: Success
    principalUser|expand: '%vip_users%'
  office:
    principalIp|expand: '%admin_addresses%'
  condition: vip_sign_in and not office
`;

export function createWatchlistsFixture(options) {
  const { insert, table, ID, ago, people, isEmpty } = options;

  function tableName(modelType) {
    return new modelType().tableName;
  }

  const WATCHLIST = tableName(SecurityWatchlist);
  const VALUE = tableName(SecurityWatchlistItem);

  function isWatchlistTable(modelName) {
    return modelName === WATCHLIST || modelName === VALUE;
  }

  function listOf(record) {
    return String(
      record.securityWatchlistId || record.securityWatchlist?._id || "",
    );
  }

  // A list's valueCount, as the server recounts it after every change.
  function recount(watchlistId) {
    const list = table(SecurityWatchlist).find((item) => {
      return String(item._id) === String(watchlistId);
    });

    if (list) {
      list.valueCount = table(SecurityWatchlistItem).filter((item) => {
        return listOf(item) === String(watchlistId);
      }).length;
    }
  }

  function recountAll() {
    for (const list of table(SecurityWatchlist)) {
      recount(list._id);
    }
  }

  function seed() {
    // Known even when empty: a page that reads them is answered, not refused.
    table(SecurityWatchlist);
    table(SecurityWatchlistItem);

    if (isEmpty) {
      return;
    }

    insert(SecurityWatchlist, {
      _id: ID.watchlist(1),
      name: "vip_users",
      description: "Executives and their assistants.",
      entityType: SecurityEntityType.User,
      source: SecurityWatchlistSource.Values,
      createdByUserId: people.maya._id,
      createdAt: ago(18 * DAY),
    });
    insert(SecurityWatchlist, {
      _id: ID.watchlist(2),
      name: "admin_addresses",
      description: "Where administrators may sign in from.",
      entityType: SecurityEntityType.IpAddress,
      source: SecurityWatchlistSource.Values,
      createdByUserId: people.diego._id,
      createdAt: ago(16 * DAY),
    });
    insert(SecurityWatchlist, {
      _id: ID.watchlist(3),
      name: "c2_addresses",
      description: "Botnet command-and-control servers.",
      entityType: SecurityEntityType.IpAddress,
      source: SecurityWatchlistSource.ThreatIntelFeed,
      threatIntelFeedId: ID.intel(1),
      createdByUserId: people.priya._id,
      createdAt: ago(9 * DAY),
    });
    insert(SecurityWatchlist, {
      _id: ID.watchlist(4),
      name: "lab_hosts",
      description: "",
      entityType: SecurityEntityType.Host,
      source: SecurityWatchlistSource.Values,
      createdByUserId: people.sam._id,
      createdAt: ago(2 * DAY),
    });

    const values = [
      [1, 1, "alice.wong@acme-commerce.example", "CEO", people.maya, 18 * DAY],
      [2, 1, "ben.ortiz@acme-commerce.example", "CFO", people.maya, 18 * DAY],
      [
        3,
        1,
        "finance-admin-*@acme-commerce.example",
        "The finance team's admin accounts.",
        people.diego,
        4 * DAY,
      ],
      [4, 2, "10.20.0.0/16", "Office network", people.diego, 16 * DAY],
      [5, 2, "198.51.100.10", "VPN egress", people.diego, 16 * DAY],
      [6, 2, "203.0.113.0/28", "Bastion hosts", people.priya, 3 * HOUR],
    ];

    for (const [n, list, value, note, person, age] of values) {
      insert(SecurityWatchlistItem, {
        _id: ID.watchlistValue(n),
        securityWatchlistId: ID.watchlist(list),
        value,
        note,
        createdByUserId: person._id,
        createdAt: ago(age),
      });
    }

    insert(DetectionRule, {
      _id: ID.rule(32),
      name: WATCHLIST_READING_RULE,
      description:
        "An executive signing in from anywhere but the office, the VPN or a bastion host.",
      sigmaRuleYaml: WATCHLIST_READING_RULE_YAML,
      // Off while it is tuned: the overview's count of rules on is unchanged.
      isEnabled: false,
      evaluationIntervalInMinutes: 5,
      shouldCreateCase: true,
      createdAt: ago(4 * DAY),
    });

    recountAll();
  }

  // A row as the pages read it: a list's feed by name, a value's adder.
  function withRelations(modelName, record) {
    if (modelName === WATCHLIST) {
      const feed = table(ThreatIntelFeed).find((item) => {
        return String(item._id) === String(record.threatIntelFeedId || "");
      });

      return {
        ...record,
        threatIntelFeed: feed
          ? Object.assign(new ThreatIntelFeed(), {
              _id: feed._id,
              name: feed.name,
            })
          : undefined,
      };
    }

    const person = Object.values(people).find((member) => {
      return String(member._id) === String(record.createdByUserId || "");
    });

    return {
      ...record,
      securityWatchlistId: listOf(record) || undefined,
      createdByUser: person,
    };
  }

  // A create, before it is stored: what the server would add to it.
  function onCreate(modelName, record) {
    if (modelName === WATCHLIST) {
      record.source = record.source || SecurityWatchlistSource.Values;
      record.valueCount = 0;
      record.createdByUserId = people.maya._id;
      return;
    }

    if (modelName === VALUE) {
      record.securityWatchlistId = listOf(record);
      record.value = normalizeSecurityWatchlistValue(record.value);
      record.createdByUserId = people.maya._id;
    }
  }

  // After a write: a list's count follows its values, and a list's values go with it.
  function afterWrite(modelName) {
    if (modelName === WATCHLIST) {
      const lists = new Set(
        table(SecurityWatchlist).map((item) => {
          return String(item._id);
        }),
      );
      const values = table(SecurityWatchlistItem);

      for (let index = values.length - 1; index >= 0; index--) {
        if (!lists.has(listOf(values[index]))) {
          values.splice(index, 1);
        }
      }
    }

    if (isWatchlistTable(modelName)) {
      recountAll();
    }
  }

  /*
   * POST /security-watchlist/import: { status, body }, as the server
   * answers it.
   */
  function importValues(body) {
    const request = body || {};
    const watchlistId = String(request.securityWatchlistId || "");
    const list = table(SecurityWatchlist).find((item) => {
      return String(item._id) === watchlistId;
    });

    if (!list) {
      return { status: 404, body: { message: "Watchlist not found." } };
    }

    const parsed = parseSecurityWatchlistImport({
      text: String(request.text || ""),
      entityType: list.entityType,
    });
    const isReplace = request.mode === SecurityWatchlistImportMode.Replace;

    if (isReplace && parsed.values.length === 0) {
      return {
        status: 400,
        body: {
          message:
            "The import has no values to replace the list with. To empty a list, delete its values.",
        },
      };
    }

    const values = table(SecurityWatchlistItem);
    const held = values.filter((item) => {
      return listOf(item) === watchlistId;
    });
    const heldKeys = new Set(
      held.map((item) => {
        return getSecurityWatchlistValueKey(item.value);
      }),
    );
    const importedKeys = new Set(
      parsed.values.map((item) => {
        return getSecurityWatchlistValueKey(item.value);
      }),
    );

    let removed = 0;

    if (isReplace) {
      for (let index = values.length - 1; index >= 0; index--) {
        const item = values[index];

        if (
          listOf(item) === watchlistId &&
          !importedKeys.has(getSecurityWatchlistValueKey(item.value))
        ) {
          values.splice(index, 1);
          removed++;
        }
      }
    }

    let added = 0;

    for (const item of parsed.values) {
      if (heldKeys.has(getSecurityWatchlistValueKey(item.value))) {
        continue;
      }

      insert(SecurityWatchlistItem, {
        securityWatchlistId: watchlistId,
        value: item.value,
        note: item.note,
        createdByUserId: people.maya._id,
      });
      added++;
    }

    recount(watchlistId);

    return {
      status: 200,
      body: {
        added,
        removed,
        unchanged: parsed.values.length - added,
        duplicates: parsed.duplicates,
        problemCount: parsed.problems.length,
        problems: parsed.problems.slice(0, PROBLEMS_SHOWN),
        valueCount: list.valueCount,
      },
    };
  }

  return {
    seed,
    isWatchlistTable,
    withRelations,
    onCreate,
    afterWrite,
    importValues,
  };
}
