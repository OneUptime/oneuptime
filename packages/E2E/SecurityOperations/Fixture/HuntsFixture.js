/*
 * Hunts on the fixture's synthetic month: the saved searches Security
 * Events > Events > Hunts lists, the security events the Events explorer
 * (and a hunt's page) reads, and what POST /security-case-evidence/add-events
 * answers when events are kept on a case.
 *
 *   Encoded PowerShell                every day, tells Maya and SOC Tier 2;
 *                                     its last run found the 3 encoded
 *                                     PowerShell starts on web-03 of the
 *                                     past day
 *   Admin sign-ins outside the office every hour, tells Diego; its runs have
 *                                     found nothing yet (sign-ins only, with
 *                                     failures left out by a chip)
 *   Threat intel matches              not scheduled; searches with a chip
 *                                     alone (@threat.matched is true)
 *   Sudo by service accounts          every 6 hours; its last run could not
 *                                     be made: the person who set its
 *                                     schedule can no longer read security
 *                                     events
 *
 * CASE-138 (Defender XDR: suspicious PowerShell on web-03) keeps one of the
 * PowerShell events as evidence, found by the first hunt.
 *
 * The events are read as the Events explorer reads them: its list (by the
 * time window, the search and the chips, compiled by the page itself into
 * the query it sends), the volume chart and the facet counts (aggregates),
 * and the newest event (one row, no window). The search's operators are
 * matched here as ClickHouse matches them - equality, contains, any of,
 * none of, not equal and wildcards - without a regular expression built
 * from text.
 *
 * ?hunts= empty: the project has saved no hunt yet.
 */
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import SecurityCaseEvidence from "Common/Models/DatabaseModels/SecurityCaseEvidence";
import SecurityHunt from "Common/Models/DatabaseModels/SecurityHunt";
import Service from "Common/Models/DatabaseModels/Service";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import Search from "Common/Types/BaseDatabase/Search";
import Wildcard from "Common/Types/BaseDatabase/Wildcard";
import ObjectID from "Common/Types/ObjectID";
import SecurityCaseEvidenceKind from "Common/Types/SecurityCase/SecurityCaseEvidenceKind";
import {
  SECURITY_CASE_EVENT_SNAPSHOT_COLUMNS,
  buildSecurityCaseEventSnapshot,
  getSecurityCaseEventEvidenceName,
  readSecurityCaseEventReferences,
} from "Common/Types/SecurityCase/SecurityCaseEventEvidence";
import {
  SECURITY_HUNT_RUN_ERRORS,
  SecurityHuntSchedule,
  getSecurityHuntIntervalInMinutes,
  getSecurityHuntSearchStart,
  isScheduledSecurityHunt,
} from "Common/Types/SecurityEvent/SecurityHunt";
import TimeRange from "Common/Types/Time/TimeRange";

export const HUNT_SCENARIOS = ["empty"];

// The hunt the case's kept event names, and the case.
export const FOUND_EVIDENCE_CASE = 138;

/*
 * Whether `text` matches a glob - `*` any run of characters, `?` one - the
 * way the search's wildcards match, whatever the case. A walk over both
 * strings with one step back for the last `*`: no regular expression built
 * from what a person typed.
 */
export function globMatches(text, pattern) {
  const value = String(text || "").toLowerCase();
  const glob = String(pattern || "").toLowerCase();
  let valueIndex = 0;
  let globIndex = 0;
  let starIndex = -1;
  let matchIndex = 0;

  while (valueIndex < value.length) {
    if (
      globIndex < glob.length &&
      (glob[globIndex] === "?" || glob[globIndex] === value[valueIndex])
    ) {
      valueIndex++;
      globIndex++;
    } else if (globIndex < glob.length && glob[globIndex] === "*") {
      starIndex = globIndex;
      matchIndex = valueIndex;
      globIndex++;
    } else if (starIndex !== -1) {
      globIndex = starIndex + 1;
      matchIndex++;
      valueIndex = matchIndex;
    } else {
      return false;
    }
  }

  while (globIndex < glob.length && glob[globIndex] === "*") {
    globIndex++;
  }

  return globIndex === glob.length;
}

function asText(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.join(",");
  }
  return String(value);
}

// One condition of the query on one value, as the search compiles it.
function conditionMatches(actual, condition) {
  if (condition === undefined) {
    return true;
  }
  if (condition instanceof Search) {
    return asText(actual)
      .toLowerCase()
      .includes(String(condition.value).toLowerCase());
  }
  if (condition instanceof Wildcard) {
    return globMatches(asText(actual), condition.value);
  }
  if (condition instanceof Includes) {
    return (condition.values || []).map(String).includes(asText(actual));
  }
  if (condition instanceof IncludesNone) {
    return !(condition.values || []).map(String).includes(asText(actual));
  }
  if (condition instanceof NotEqual) {
    return asText(actual) !== String(condition.value);
  }
  if (condition instanceof InBetween) {
    const time = new Date(actual).getTime();
    return (
      time >= new Date(condition.startValue).getTime() &&
      time <= new Date(condition.endValue).getTime()
    );
  }
  if (condition instanceof ObjectID) {
    return asText(actual) === condition.toString();
  }
  if (typeof condition === "object" && condition !== null) {
    // An operator this fixture does not model matches nothing, never everything.
    return false;
  }
  return asText(actual) === String(condition);
}

export function eventMatches(event, query) {
  for (const [key, condition] of Object.entries(query || {})) {
    if (key === "projectId") {
      continue;
    }
    if (key === "attributes") {
      for (const [attribute, attributeCondition] of Object.entries(
        condition || {},
      )) {
        if (
          !conditionMatches(
            (event.attributes || {})[attribute],
            attributeCondition,
          )
        ) {
          return false;
        }
      }
      continue;
    }
    if (!conditionMatches(event[key], condition)) {
      return false;
    }
  }
  return true;
}

export function createHuntsFixture(options) {
  const {
    insert,
    table,
    ID,
    ago,
    people,
    socTeam,
    isEmpty,
    NOW,
    MINUTE,
    HOUR,
    DAY,
    huntsScenario,
    findCaseByNumber,
    projectObjectId,
  } = options;

  function tableName(modelType) {
    return new modelType().tableName;
  }

  const HUNT = tableName(SecurityHunt);
  const SERVICE = tableName(Service);
  const EVENT = tableName(SecurityEvent);

  function later(milliseconds) {
    return new Date(NOW.getTime() + milliseconds);
  }

  // The security sources the events arrived from, by the Service each stands for.
  const SOURCES = {
    defender: { _id: ID.source(1), name: "Microsoft Defender XDR" },
    okta: { _id: ID.source(2), name: "Okta" },
    linux: { _id: ID.source(3), name: "Linux hosts" },
  };

  function event(number, record) {
    return {
      _id: ID.event(number),
      projectId: projectObjectId,
      eventUid: `evt-${String(number).padStart(4, "0")}`,
      severityName: "Medium",
      categoryName: "System Activity",
      className: "Process Activity",
      activityName: "Launch",
      statusName: "Success",
      vendorName: "Microsoft",
      productName: "Defender for Endpoint",
      ruleName: "",
      principalUser: "",
      principalHost: "",
      principalIp: "",
      processName: "",
      processCommandLine: "",
      targetUser: "",
      targetHost: "",
      targetIp: "",
      observables: [],
      mitreTactics: [],
      mitreTechniques: [],
      attributes: {},
      ...record,
    };
  }

  /*
   * The month's events the explorer lists: the encoded PowerShell starts on
   * web-03 (three in the past day, two older), Okta sign-ins, sudo on the
   * Linux hosts and a threat intel match.
   */
  const EVENTS = isEmpty
    ? []
    : [
        event(1, {
          time: ago(5 * HOUR),
          severityName: "High",
          message: "Encoded PowerShell started by a web worker on web-03",
          principalUser: "svc-web@acme-commerce.example",
          principalHost: "web-03",
          principalIp: "10.20.4.13",
          processName: "powershell.exe",
          processCommandLine:
            "powershell.exe -NoProfile -enc SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoA",
          primaryEntityId: new ObjectID(SOURCES.defender._id),
          mitreTechniques: ["T1059.001"],
          attributes: { "device.hostname": "web-03" },
        }),
        event(2, {
          time: ago(9 * HOUR),
          severityName: "High",
          message: "Encoded PowerShell downloaded a script on web-03",
          principalUser: "svc-web@acme-commerce.example",
          principalHost: "web-03",
          principalIp: "10.20.4.13",
          processName: "powershell.exe",
          processCommandLine:
            "powershell.exe -w hidden -enc SQBFAFgAIAAoAEkAbgB2AG8AawBlAC0A",
          primaryEntityId: new ObjectID(SOURCES.defender._id),
          mitreTechniques: ["T1059.001"],
          attributes: { "device.hostname": "web-03" },
        }),
        event(3, {
          time: ago(20 * HOUR),
          severityName: "Critical",
          message: "Encoded PowerShell reached out to update-check.example",
          principalUser: "svc-web@acme-commerce.example",
          principalHost: "web-03",
          principalIp: "10.20.4.13",
          processName: "powershell.exe",
          processCommandLine:
            "powershell.exe -enc aQBlAHgAIAAoAG4AZQB3AC0AbwBiAGoAZQBjAHQA",
          primaryEntityId: new ObjectID(SOURCES.defender._id),
          observables: ["update-check.example"],
          attributes: {
            "device.hostname": "web-03",
            "threat.matched": "true",
          },
        }),
        event(4, {
          time: ago(3 * DAY),
          severityName: "Medium",
          message: "Encoded PowerShell started from a scheduled task on web-01",
          principalUser: "svc-deploy@acme-commerce.example",
          principalHost: "web-01",
          processName: "powershell.exe",
          processCommandLine: "powershell.exe -enc JABzAD0ATgBlAHcALQBPAGIA",
          primaryEntityId: new ObjectID(SOURCES.defender._id),
          attributes: { "device.hostname": "web-01" },
        }),
        event(5, {
          time: ago(5 * DAY),
          severityName: "Low",
          message: "PowerShell ran a signed admin script on fin-ws-112",
          principalUser: "p.nair@acme-commerce.example",
          principalHost: "fin-ws-112",
          processName: "powershell.exe",
          processCommandLine: "powershell.exe -File C:\\ops\\rotate-logs.ps1",
          primaryEntityId: new ObjectID(SOURCES.defender._id),
          attributes: { "device.hostname": "fin-ws-112" },
        }),
        event(6, {
          time: ago(2 * HOUR),
          severityName: "Informational",
          categoryName: "Identity & Access Management",
          className: "Authentication",
          activityName: "Logon",
          statusName: "Success",
          vendorName: "Okta",
          productName: "Okta System Log",
          message: "admin.ops signed in to the Okta admin console",
          principalUser: "admin.ops@acme-commerce.example",
          principalIp: "192.0.2.10",
          primaryEntityId: new ObjectID(SOURCES.okta._id),
          attributes: { "client.geo.country": "US" },
        }),
        event(7, {
          time: ago(7 * HOUR),
          severityName: "Medium",
          categoryName: "Identity & Access Management",
          className: "Authentication",
          activityName: "Logon",
          statusName: "Failure",
          vendorName: "Okta",
          productName: "Okta System Log",
          message: "admin.finance failed to sign in: wrong password",
          principalUser: "admin.finance@acme-commerce.example",
          principalIp: "203.0.113.47",
          primaryEntityId: new ObjectID(SOURCES.okta._id),
          attributes: { "client.geo.country": "NL" },
        }),
        event(8, {
          time: ago(30 * MINUTE),
          severityName: "Low",
          categoryName: "System Activity",
          className: "Process Activity",
          activityName: "sudo",
          vendorName: "Linux",
          productName: "auth.log",
          message: "svc-backup ran sudo tar on db-02",
          principalUser: "svc-backup",
          principalHost: "db-02",
          processName: "sudo",
          processCommandLine:
            "sudo tar -czf /backups/db.tgz /var/lib/postgresql",
          primaryEntityId: new ObjectID(SOURCES.linux._id),
        }),
        event(9, {
          time: ago(13 * HOUR),
          severityName: "Medium",
          className: "Process Activity",
          activityName: "sudo",
          vendorName: "Linux",
          productName: "auth.log",
          message: "k.morgan ran sudo -i on bastion-01",
          principalUser: "k.morgan",
          principalHost: "bastion-01",
          processName: "sudo",
          processCommandLine: "sudo -i",
          primaryEntityId: new ObjectID(SOURCES.linux._id),
        }),
      ];

  function seed() {
    // Known even when empty: a page that reads them is answered, not refused.
    table(SecurityHunt);
    table(Service);

    for (const source of Object.values(SOURCES)) {
      insert(Service, { ...source });
    }

    if (isEmpty || huntsScenario === "empty") {
      return;
    }

    insert(SecurityHunt, {
      _id: ID.hunt(1),
      name: "Encoded PowerShell",
      // Longer than two lines on a phone: the hunt's header folds the rest under Show more.
      description:
        "PowerShell started with an encoded command, as attackers start what they would rather nobody read. When it finds something, check the parent process and the host's other sign-ins before you open a case.",
      searchQuery: "processname:powershell.exe commandline:-enc",
      filters: {},
      timeRange: TimeRange.PAST_ONE_WEEK,
      schedule: SecurityHuntSchedule.EveryDay,
      notifyUsers: [people.maya],
      notifyTeams: [socTeam],
      scheduledByUserId: people.maya._id,
      searchedUpToAt: ago(2 * HOUR + 2 * MINUTE),
      nextRunAt: later(22 * HOUR),
      lastRunAt: ago(2 * HOUR),
      lastRunEventCount: 3,
      lastFoundAt: ago(2 * HOUR + 2 * MINUTE),
      lastFoundSinceAt: ago(26 * HOUR + 2 * MINUTE),
      lastFoundEventCount: 3,
      createdByUserId: people.maya._id,
      createdAt: ago(12 * DAY),
    });
    insert(SecurityHunt, {
      _id: ID.hunt(2),
      name: "Admin sign-ins outside the office",
      searchQuery: "class:Authentication user:admin.*",
      filters: { "!statusName": ["Failure"] },
      timeRange: TimeRange.PAST_ONE_DAY,
      schedule: SecurityHuntSchedule.EveryHour,
      notifyUsers: [people.diego],
      notifyTeams: [],
      scheduledByUserId: people.diego._id,
      searchedUpToAt: ago(22 * MINUTE),
      nextRunAt: later(40 * MINUTE),
      lastRunAt: ago(20 * MINUTE),
      lastRunEventCount: 0,
      createdByUserId: people.diego._id,
      createdAt: ago(6 * DAY),
    });
    insert(SecurityHunt, {
      _id: ID.hunt(3),
      name: "Threat intel matches",
      description: "Every event that names a known-bad indicator.",
      searchQuery: "",
      filters: { "attributes.threat.matched": ["true"] },
      timeRange: TimeRange.PAST_ONE_MONTH,
      schedule: SecurityHuntSchedule.NotScheduled,
      notifyUsers: [],
      notifyTeams: [],
      createdByUserId: people.priya._id,
      createdAt: ago(3 * DAY),
    });
    insert(SecurityHunt, {
      _id: ID.hunt(4),
      name: "Sudo by service accounts",
      searchQuery: "activity:sudo user:svc-*",
      filters: {},
      timeRange: TimeRange.PAST_ONE_WEEK,
      schedule: SecurityHuntSchedule.EverySixHours,
      notifyUsers: [people.sam],
      notifyTeams: [],
      scheduledByUserId: people.sam._id,
      searchedUpToAt: ago(9 * HOUR),
      nextRunAt: later(1 * HOUR),
      lastRunAt: ago(3 * HOUR),
      lastRunEventCount: null,
      lastRunError: SECURITY_HUNT_RUN_ERRORS.schedulerCannotRead.message,
      createdByUserId: people.sam._id,
      createdAt: ago(9 * DAY),
    });

    // One of the PowerShell events, kept on the web-03 case as evidence.
    const securityCase = findCaseByNumber(FOUND_EVIDENCE_CASE);

    if (securityCase) {
      keepEvent({
        securityCaseId: securityCase._id,
        event: EVENTS[1],
        hunt: { id: ID.hunt(1), name: "Encoded PowerShell" },
        userId: people.maya._id,
        createdAt: ago(90 * MINUTE),
      });
    }
  }

  function isHuntTable(modelName) {
    return modelName === HUNT;
  }

  function isEventTable(modelName) {
    return modelName === EVENT;
  }

  function personById(id) {
    return Object.values(people).find((member) => {
      return String(member._id) === String(id);
    });
  }

  // Who a hunt tells, as the people and teams they are: a form sends their ids.
  function readRecipients(record) {
    record.notifyUsers = (record.notifyUsers || [])
      .map((user) => {
        return personById(user?._id || user) || null;
      })
      .filter(Boolean);
    record.notifyTeams = (record.notifyTeams || [])
      .map((team) => {
        return String(team?._id || team) === String(socTeam._id)
          ? socTeam
          : null;
      })
      .filter(Boolean);
  }

  // What the server writes as a schedule starts: from now on, as the reader.
  function startSchedule(record) {
    const interval = getSecurityHuntIntervalInMinutes(record.schedule);

    if (!isScheduledSecurityHunt(record.schedule) || interval === null) {
      record.nextRunAt = null;
      record.searchedUpToAt = null;
      record.scheduledByUserId = null;
      record.lastRunError = null;
      return;
    }

    record.searchedUpToAt = getSecurityHuntSearchStart(NOW);
    record.nextRunAt = new Date(NOW.getTime() + interval * MINUTE);
    record.scheduledByUserId = people.maya._id;
    record.lastRunError = null;
  }

  function onCreate(modelName, record) {
    if (!isHuntTable(modelName)) {
      return;
    }
    record.schedule = record.schedule || SecurityHuntSchedule.NotScheduled;
    record.timeRange = record.timeRange || TimeRange.PAST_ONE_WEEK;
    record.filters = record.filters || {};
    record.createdByUserId = people.maya._id;
    readRecipients(record);
    startSchedule(record);
  }

  // An edit that changes the schedule or the search starts the schedule again.
  function onUpdate(modelName, record, data) {
    if (!isHuntTable(modelName)) {
      return;
    }
    readRecipients(record);
    if (
      data &&
      (data.schedule !== undefined ||
        data.searchQuery !== undefined ||
        data.filters !== undefined)
    ) {
      startSchedule(record);
    }
  }

  function withRelations(modelName, record) {
    if (!isHuntTable(modelName)) {
      return record;
    }
    return {
      ...record,
      scheduledByUser: personById(record.scheduledByUserId),
    };
  }

  // ---------- The events, as the explorer reads them ----------

  function eventsMatching(query) {
    return EVENTS.filter((item) => {
      return eventMatches(item, query);
    }).sort((left, right) => {
      return new Date(right.time).getTime() - new Date(left.time).getTime();
    });
  }

  function makeEvent(record) {
    return Object.assign(new SecurityEvent(), record);
  }

  // The list, and the newest event (one row, no window).
  function getEvents(options) {
    const skip = Number(options.skip || 0);
    const limit = Number(options.limit || 10);
    const records = eventsMatching(options.query);

    return {
      data: records.slice(skip, skip + limit).map(makeEvent),
      count: records.length,
      skip,
      limit,
      hasMore: skip + limit < records.length,
    };
  }

  function countEvents(query) {
    return eventsMatching(query).length;
  }

  /*
   * The explorer's aggregates: one count per event and severity for the
   * volume chart (the chart buckets them), and one row per value for a
   * facet (AggregationInterval Total, grouped by its column). The Rule
   * Library's grouped count by class, vendor and product is the main
   * fixture's to answer: null hands it back.
   */
  function aggregateEvents(aggregateBy) {
    const groupKeys = Object.keys(aggregateBy.groupBy || {});

    if (groupKeys.length !== 1) {
      return null;
    }

    const groupKey = groupKeys[0];
    const records = eventsMatching(aggregateBy.query);

    if (
      groupKey === "severityName" &&
      aggregateBy.aggregationInterval !== AggregationInterval.Total
    ) {
      return {
        data: records.map((item) => {
          return {
            timestamp: new Date(item.time),
            value: 1,
            severityName: item.severityName,
          };
        }),
      };
    }

    const counts = new Map();

    for (const item of records) {
      const value = asText(item[groupKey]);

      if (value) {
        counts.set(value, (counts.get(value) || 0) + 1);
      }
    }

    return {
      data: Array.from(counts.entries())
        .sort((left, right) => {
          return right[1] - left[1];
        })
        .map(([value, count]) => {
          return { [groupKey]: value, value: count };
        }),
    };
  }

  function attributeKeys() {
    const keys = new Set();

    for (const item of EVENTS) {
      for (const key of Object.keys(item.attributes || {})) {
        keys.add(key);
      }
    }

    return Array.from(keys).sort();
  }

  function attributeValues(key) {
    const values = new Set();

    for (const item of EVENTS) {
      const value = (item.attributes || {})[key];

      if (value) {
        values.add(String(value));
      }
    }

    return Array.from(values).sort();
  }

  // ---------- Keeping events on a case ----------

  function keepEvent(data) {
    const row = {};

    for (const column of SECURITY_CASE_EVENT_SNAPSHOT_COLUMNS) {
      row[column] = data.event[column];
    }

    const snapshot = buildSecurityCaseEventSnapshot({
      event: row,
      hunt: data.hunt || null,
    });

    return insert(SecurityCaseEvidence, {
      _id: data.id || undefined,
      securityCaseId: new ObjectID(String(data.securityCaseId)),
      kind: SecurityCaseEvidenceKind.Event,
      name: getSecurityCaseEventEvidenceName(snapshot),
      eventUid: snapshot.eventUid,
      eventTime: new Date(snapshot.time),
      eventSnapshot: snapshot,
      createdByUserId: data.userId,
      createdAt: data.createdAt || NOW,
    });
  }

  /*
   * POST /security-case-evidence/add-events, as the server answers it: each
   * event named is read from the events (an id the events do not hold is not
   * found), kept on the case unless it keeps it already.
   */
  function addEvents(body) {
    const caseId = String(body?.securityCaseId || "");
    const references = readSecurityCaseEventReferences(body?.events);
    const huntId = body?.securityHuntId ? String(body.securityHuntId) : null;
    const hunt = huntId
      ? table(SecurityHunt).find((item) => {
          return String(item._id) === huntId;
        })
      : null;
    const result = { added: [], alreadyOnCase: [], notFound: [] };

    for (const reference of references) {
      const kept = table(SecurityCaseEvidence).some((item) => {
        return (
          String(item.securityCaseId) === caseId &&
          item.kind === SecurityCaseEvidenceKind.Event &&
          item.eventUid === reference.eventUid
        );
      });

      if (kept) {
        result.alreadyOnCase.push(reference.eventUid);
        continue;
      }

      const found = EVENTS.find((item) => {
        return item.eventUid === reference.eventUid;
      });

      if (!found) {
        result.notFound.push(reference.eventUid);
        continue;
      }

      keepEvent({
        securityCaseId: caseId,
        event: found,
        hunt: hunt ? { id: String(hunt._id), name: hunt.name } : null,
        userId: people.maya._id,
      });
      result.added.push(reference.eventUid);
    }

    return result;
  }

  return {
    seed,
    isHuntTable,
    isEventTable,
    onCreate,
    onUpdate,
    withRelations,
    getEvents,
    countEvents,
    aggregateEvents,
    attributeKeys,
    attributeValues,
    addEvents,
    EVENTS,
  };
}
