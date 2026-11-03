/*
 * Watchlists on the fixture's synthetic month: the lists Security Events >
 * Detections > Watchlists shows, each list's values, the rule that reads
 * two of them, the Security Events monitor that reads a third, and what
 * POST /security-watchlist/import and /security-watchlist/read-now answer.
 *
 *   vip_users         Users, kept by hand: the CEO, the CFO and the
 *                     finance admins' accounts (a pattern with *)
 *   admin_addresses   IP addresses, kept by hand: the office range, the
 *                     VPN's address and the bastion hosts' range
 *   c2_addresses      IP addresses, following the Feodo Tracker list
 *   contractors       Users, read every day from HR's file at an https
 *                     address: two contractors, one leaving the list in
 *                     twelve days; the last read, two hours ago, left a
 *                     line of the file out. ?urlread=failed: its last read,
 *                     ten minutes ago, failed (HR's server answered 503),
 *                     and its values are from the read two days before;
 *                     ?urlread=waiting: a list just saved, waiting for its
 *                     first read, with no values yet
 *   lab_hosts         Hosts, kept by hand, with no values yet
 *
 * So the common lists still offered are Critical hosts and Known-bad file
 * hashes. "VIP sign-in from outside the office" (off, while it is tuned)
 * reads vip_users and admin_addresses; the Security Events monitor
 * "Contractor sign-ins" reads contractors in its Filter by Watchlists;
 * nothing reads the other two. ?readers=many: vip_users is read by a
 * second monitor and a hunt as well.
 *
 * The server's own bookkeeping is kept as the server keeps it: a list's
 * valueCount follows its values as they are added, imported and deleted,
 * and a list's values go with it. An import reads its text with the
 * shared reader the server uses (parseSecurityWatchlistImport), adds to the
 * list or replaces it, and answers what it did.
 */
import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import SecurityWatchlist from "Common/Models/DatabaseModels/SecurityWatchlist";
import SecurityWatchlistItem from "Common/Models/DatabaseModels/SecurityWatchlistItem";
import ThreatIntelFeed from "Common/Models/DatabaseModels/ThreatIntelFeed";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import { MonitorStepSecurityEventsMonitorUtil } from "Common/Types/Monitor/MonitorStepSecurityEventsMonitor";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { SecurityEntityType } from "Common/Types/SecurityCase/SecurityEntity";
import SecurityHunt from "Common/Models/DatabaseModels/SecurityHunt";
import {
  SECURITY_WATCHLIST_MESSAGES,
  SecurityWatchlistImportMode,
  SecurityWatchlistImportSchedule,
  SecurityWatchlistSource,
  getNextSecurityWatchlistImportAt,
  getSecurityWatchlistImportRetryAt,
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

export const WATCHLIST_READING_MONITOR = "Contractor sign-ins";

// Where HR publishes its contractors: the list read from an address.
export const CONTRACTORS_URL =
  "https://hr.acme-commerce.example/exports/contractors.csv";

/*
 * ?urlread=: how the reads of HR's file stand - failed (the last read
 * could not download it) or waiting (a list just saved, waiting for its
 * first read); none: the last read worked, two hours ago.
 */
export const WATCHLIST_READ_SCENARIOS = ["failed", "waiting"];

// ?readers=many: vip_users is read by a second monitor and a hunt too.
export const WATCHLIST_READER_SCENARIOS = ["many"];

export const WATCHLIST_SECOND_MONITOR = "VIP failures";
export const WATCHLIST_READING_HUNT = "VIP sign-ins at night";

/*
 * HR's file as the next read finds it: one more contractor than the last
 * read did, and a contract that ended, which the read leaves out (its
 * moment to leave the list has passed) - so Read Now says what it added,
 * what was already there, and which line it left out and why.
 */
export const CONTRACTORS_FILE = [
  "value,note,expires",
  "jo.kim@contractor.example,Design agency,2026-10-26",
  "sam.lee@contractor.example,,",
  "ana.ruiz@contractor.example,Data migration,",
  "lee.park@contractor.example,Contract ended,2026-09-30",
  "",
].join("\n");

// What HR's server answers while it is down (?urlread=failed).
export const CONTRACTORS_READ_FAILURE_DETAIL =
  "Data source responded with HTTP 503: Service Unavailable";

// A Security Events monitor whose watchlist filter reads a list.
function securityEventsSteps(watchlist) {
  const step = new MonitorStep();
  step.setSecurityEventsMonitor({
    ...MonitorStepSecurityEventsMonitorUtil.getDefault(),
    classNames: ["Authentication"],
    watchlistFilters: [{ field: "principalUser", watchlist }],
  });

  const steps = new MonitorSteps();
  steps.setMonitorStepsInstanceArray([step]);
  return steps;
}

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
  const readScenario = options.readScenario || "";
  const readerScenario = options.readerScenario || "";

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

  // How the reads of HR's file stand, as the list records them (?urlread=).
  function contractorsReads() {
    if (readScenario === "waiting") {
      return {
        lastImportAt: null,
        lastImportSucceededAt: null,
        lastImportError: null,
        lastImportErrorDetail: null,
        lastImportLinesLeftOut: null,
        // Due: a new list is read within a minute of its save.
        nextImportAt: ago(0),
      };
    }

    if (readScenario === "failed") {
      return {
        lastImportAt: ago(10 * MINUTE),
        lastImportSucceededAt: ago(2 * DAY),
        lastImportError: SECURITY_WATCHLIST_MESSAGES.urlNotRead.message,
        lastImportErrorDetail: CONTRACTORS_READ_FAILURE_DETAIL,
        lastImportLinesLeftOut: 1,
        // A read that failed is tried again within the hour.
        nextImportAt: ago(-50 * MINUTE),
      };
    }

    return {
      lastImportAt: ago(2 * HOUR),
      lastImportSucceededAt: ago(2 * HOUR),
      lastImportError: null,
      lastImportErrorDetail: null,
      lastImportLinesLeftOut: 1,
      nextImportAt: ago(2 * HOUR - DAY),
    };
  }

  function seed() {
    // Known even when empty: a page that reads them is answered, not refused.
    table(SecurityWatchlist);
    table(SecurityWatchlistItem);
    // What reads a list: its Security Events monitors are read with its rules.
    table(Monitor);

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
    insert(SecurityWatchlist, {
      _id: ID.watchlist(5),
      name: "contractors",
      description: "HR's list of contractors, read every day.",
      entityType: SecurityEntityType.User,
      source: SecurityWatchlistSource.Url,
      importUrl: CONTRACTORS_URL,
      importSchedule: SecurityWatchlistImportSchedule.EveryDay,
      ...contractorsReads(),
      createdByUserId: people.priya._id,
      createdAt: ago(readScenario === "waiting" ? 1 * MINUTE : 6 * DAY),
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

    // What HR's file held at its last read that worked: nobody's hand put them there.
    if (readScenario !== "waiting") {
      const readAt = readScenario === "failed" ? ago(2 * DAY) : ago(2 * HOUR);

      insert(SecurityWatchlistItem, {
        _id: ID.watchlistValue(7),
        securityWatchlistId: ID.watchlist(5),
        value: "jo.kim@contractor.example",
        note: "Design agency",
        // Leaves the list when the contract ends.
        expiresAt: ago(-12 * DAY),
        createdAt: readAt,
      });
      insert(SecurityWatchlistItem, {
        _id: ID.watchlistValue(8),
        securityWatchlistId: ID.watchlist(5),
        value: "sam.lee@contractor.example",
        note: "",
        createdAt: readAt,
      });
    }

    insert(Monitor, {
      _id: ID.monitor(1),
      name: WATCHLIST_READING_MONITOR,
      monitorType: MonitorType.SecurityEvents,
      monitorSteps: securityEventsSteps("contractors"),
      createdAt: ago(5 * DAY),
    });

    if (readerScenario === "many") {
      insert(Monitor, {
        _id: ID.monitor(2),
        name: WATCHLIST_SECOND_MONITOR,
        monitorType: MonitorType.SecurityEvents,
        monitorSteps: securityEventsSteps("vip_users"),
        createdAt: ago(3 * DAY),
      });
      insert(SecurityHunt, {
        _id: ID.hunt(9),
        name: WATCHLIST_READING_HUNT,
        searchQuery: "class:Authentication user:%vip_users%",
        filters: {},
        createdByUserId: people.maya._id,
        createdAt: ago(1 * DAY),
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

  /*
   * POST /security-watchlist/read-now: { status, body }, as the server
   * answers it - the list read at once and made HR's file
   * (CONTRACTORS_FILE), as an import with Replace reads it: its values,
   * their notes and when each leaves, the line whose moment has passed
   * left out with why. The read is recorded on the list as a scheduled
   * one is. ?urlread=failed: HR's server is still down - the list keeps
   * its values, and the failure is recorded, with its next try.
   */
  function readNow(body) {
    const request = body || {};
    const watchlistId = String(request.securityWatchlistId || "");
    const list = table(SecurityWatchlist).find((item) => {
      return String(item._id) === watchlistId;
    });

    if (!list) {
      return { status: 404, body: { message: "Watchlist not found." } };
    }

    if (list.source !== SecurityWatchlistSource.Url) {
      return {
        status: 400,
        body: {
          message: "Only a watchlist read from an address is read from one.",
        },
      };
    }

    const now = ago(0);

    if (readScenario === "failed") {
      list.lastImportAt = now;
      list.lastImportError = SECURITY_WATCHLIST_MESSAGES.urlNotRead.message;
      list.lastImportErrorDetail = CONTRACTORS_READ_FAILURE_DETAIL;
      list.nextImportAt = getSecurityWatchlistImportRetryAt({
        schedule: list.importSchedule,
        now,
      });

      return {
        status: 200,
        body: {
          error: list.lastImportError,
          errorDetail: list.lastImportErrorDetail,
          added: 0,
          removed: 0,
          unchanged: 0,
          duplicates: 0,
          problemCount: 0,
          problems: [],
          valueCount: list.valueCount,
        },
      };
    }

    const parsed = parseSecurityWatchlistImport({
      text: CONTRACTORS_FILE,
      entityType: list.entityType,
      now,
    });
    const fileKeys = new Set(
      parsed.values.map((item) => {
        return getSecurityWatchlistValueKey(item.value);
      }),
    );
    const values = table(SecurityWatchlistItem);
    let removed = 0;

    for (let index = values.length - 1; index >= 0; index--) {
      const item = values[index];

      if (
        listOf(item) === watchlistId &&
        !fileKeys.has(getSecurityWatchlistValueKey(item.value))
      ) {
        values.splice(index, 1);
        removed++;
      }
    }

    let added = 0;
    let unchanged = 0;

    for (const item of parsed.values) {
      const held = values.find((value) => {
        return (
          listOf(value) === watchlistId &&
          getSecurityWatchlistValueKey(value.value) ===
            getSecurityWatchlistValueKey(item.value)
        );
      });

      // A read makes the list the file: notes and when each leaves included.
      if (held) {
        held.note = item.note;
        held.expiresAt = item.expiresAt || null;
        unchanged++;
        continue;
      }

      insert(SecurityWatchlistItem, {
        securityWatchlistId: watchlistId,
        value: item.value,
        note: item.note,
        expiresAt: item.expiresAt || null,
        createdAt: now,
      });
      added++;
    }

    list.lastImportAt = now;
    list.lastImportSucceededAt = now;
    list.lastImportError = null;
    list.lastImportErrorDetail = null;
    list.lastImportLinesLeftOut = parsed.problems.length;
    list.nextImportAt = getNextSecurityWatchlistImportAt({
      schedule: list.importSchedule,
      now,
    });
    recount(watchlistId);

    return {
      status: 200,
      body: {
        error: null,
        errorDetail: null,
        added,
        removed,
        unchanged,
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
    readNow,
  };
}
