/*
 * A security case as the rest of OneUptime tells it, on the fixture's own
 * records: what POST /security-case-context/story and /impact answer for a
 * case's Story page and the Impact card on its Overview, worked out the way
 * the server works them out (Common/Server/Utils/SecurityCase/Context/
 * SecurityCaseStory and SecurityCaseImpact) - the events told in runs and
 * the items merged on one time axis by Common/Utils/SecurityCase/
 * SecurityCaseStoryItems, a record's last change, its place on the service
 * map and the internet verdict by Common/Utils/SecurityCase/
 * SecurityCaseImpactFacts - so a story or an impact here is one there.
 *
 * Both are read around the case's window (the one Connected Signals reads)
 * from what the fixture already holds - the case and its detections,
 * playbook runs and notes, and the records Connected Signals lists for it
 * (ConnectionsFixture.js) - and from what the rest of OneUptime knows
 * beside them:
 *
 *   CASE_EVENTS    the security events naming each open case's entities:
 *                  the spray's failed Okta sign-ins (and the success among
 *                  them) and the Okta Verify device enrolled for k.morgan
 *                  after it; build-runner-07's lookups of the known-bad
 *                  domain and its connections out; the encoded PowerShell
 *                  under web-03's web server; the credential dump on
 *                  fin-ws-112; k.morgan's two sign-ins; deploy-bot's API
 *                  key; the test attack's failed sign-ins
 *   RECORD_FACTS   what a record holds that Connected Signals does not list:
 *                  the teams that own it, its place on the service map
 *                  (build-runner-07 has an inventory item; web-03 has none),
 *                  what changed on it in the week before the case, and when
 *                  the incident or alert open on it was raised
 *   STATUS_PAGE_MONITORS  the monitors each of the project's status pages
 *                  shows: Acme Commerce Status shows web-03's Checkout API,
 *                  Engineering Tools build-runner-07's heartbeat
 *
 * No network flows arrive in this project, so no case's address is said to
 * have talked to anything; and no event here is a request OneUptime
 * followed into its trace, so the internet verdict rests on the public
 * addresses the records report.
 */
import SecurityCaseNote from "Common/Models/DatabaseModels/SecurityCaseNote";
import SecurityDetection from "Common/Models/DatabaseModels/SecurityDetection";
import SecurityPlaybookRun from "Common/Models/DatabaseModels/SecurityPlaybookRun";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import {
  SECURITY_CASE_IMPACT_MAX_FLOW_ADDRESSES,
  SECURITY_CASE_IMPACT_MAX_STATUS_PAGES,
  SECURITY_CASE_STORY_MAX_DETECTIONS,
  SECURITY_CASE_STORY_MAX_EVENTS,
  SECURITY_CASE_STORY_MAX_ITEMS,
  SECURITY_CASE_STORY_MAX_NOTES,
  SECURITY_CASE_STORY_MAX_PLAYBOOK_RUNS,
  SecurityCaseImpactSource,
  SecurityCaseStoryItemKind,
  SecurityCaseStoryMilestone,
  SecurityCaseStorySource,
} from "Common/Types/SecurityCase/SecurityCaseContext";
import { SecurityConnectionKind } from "Common/Types/SecurityCase/SecurityConnection";
import { SecurityEntityType } from "Common/Types/SecurityCase/SecurityEntity";
import SecurityEventRequestOutcome, {
  getRequestOutcomeRank,
} from "Common/Types/SecurityEvent/SecurityEventRequestOutcome";
import { getSecurityPlaybookRunStatusColor } from "Common/Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  buildInternetExposure,
  pickLastChange,
  toImpactPeers,
} from "Common/Utils/SecurityCase/SecurityCaseImpactFacts";
import {
  buildStoryExceptionItems,
  cutStoryText,
  firstLine,
  mergeStoryItems,
  runStoryEvents,
} from "Common/Utils/SecurityCase/SecurityCaseStoryItems";
import {
  canonicalAddress,
  getCaseConnectionWindow,
  readRecordAddresses,
} from "Common/Utils/SecurityCase/SecurityConnectionMatch";

// The kinds of record that can have owners (SecurityCaseImpact's OWNER_TABLES).
const OWNED_KINDS = [
  SecurityConnectionKind.Service,
  SecurityConnectionKind.Host,
  SecurityConnectionKind.KubernetesCluster,
  SecurityConnectionKind.DockerHost,
  SecurityConnectionKind.PodmanHost,
  SecurityConnectionKind.NetworkDevice,
];

// A member or a network device has no change events of its own.
const UNCHANGED_KINDS = [
  SecurityConnectionKind.User,
  SecurityConnectionKind.NetworkDevice,
];

// The OCSF severity ids of the severities the events here carry.
const SEVERITY_IDS = {
  Informational: 1,
  Low: 2,
  Medium: 3,
  High: 4,
  Critical: 5,
};

// Which story source each item kind came from, for what a bound left out.
const SOURCE_OF_KIND = {
  [SecurityCaseStoryItemKind.Detection]: SecurityCaseStorySource.Detections,
  [SecurityCaseStoryItemKind.Events]: SecurityCaseStorySource.Events,
  [SecurityCaseStoryItemKind.Exception]: SecurityCaseStorySource.Exceptions,
  [SecurityCaseStoryItemKind.Change]: SecurityCaseStorySource.Changes,
  [SecurityCaseStoryItemKind.Incident]: SecurityCaseStorySource.Incidents,
  [SecurityCaseStoryItemKind.Alert]: SecurityCaseStorySource.Alerts,
  [SecurityCaseStoryItemKind.PlaybookRun]: SecurityCaseStorySource.PlaybookRuns,
  [SecurityCaseStoryItemKind.Note]: SecurityCaseStorySource.Notes,
};

// How far back a record's last change is looked for, before the case's window.
const CHANGE_LOOKBACK_IN_DAYS = 7;

// The spray's address, the accounts it tried and their Okta org (CASE-142 in Fixture.js).
const SPRAY_IP = "203.0.113.47";
const SPRAY_USERS = [
  "j.wilson@acme-commerce.example",
  "a.ng@acme-commerce.example",
  "k.morgan@acme-commerce.example",
];
const OKTA_ORG = "acme-commerce.okta.example";

export function createCaseContextFixture(options) {
  const { now, ids, table, findCase, connections } = options;
  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  const ago = (milliseconds) => {
    return new Date(now.getTime() - milliseconds);
  };
  const iso = (value) => {
    if (!value) {
      return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  };
  const contextId = (n) => {
    return `2f000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  };

  /*
   * ---------------------------------------------------------------------------
   * The security events naming each open case's entities, by case number
   * ---------------------------------------------------------------------------
   */
  // One event as the story reads it (StoryEventRow): only what it says is given.
  const event = (caseNumber, n, time, fields) => {
    return {
      time,
      eventUid: `evt-${caseNumber}-${String(n).padStart(4, "0")}`,
      className: "",
      message: "",
      severityName: fields.severityName || "Informational",
      severityId: SEVERITY_IDS[fields.severityName || "Informational"],
      principalUser: "",
      principalHost: "",
      principalIp: "",
      targetResource: "",
      requestOutcome: "",
      traceId: "",
      spanId: "",
      sessionId: "",
      attackKind: "",
      exceptionFingerprint: "",
      exceptionType: "",
      exceptionMessage: "",
      ...fields,
    };
  };

  // `count` alike events, evenly from `from` to `to`; `fieldsAt(i)` says what the i-th says.
  const series = (caseNumber, firstN, count, from, to, fieldsAt) => {
    const step = count > 1 ? (to.getTime() - from.getTime()) / (count - 1) : 0;
    return Array.from({ length: count }, (_, index) => {
      return event(
        caseNumber,
        firstN + index,
        new Date(from.getTime() + Math.round(index * step)),
        fieldsAt(index),
      );
    });
  };

  const CASE_EVENTS = {
    /*
     * The spray: 412 failed Okta sign-ins from one Tor exit, at the three
     * accounts the case names in turn, from its first detection to its last
     * - and k.morgan's success among them; then, from the same address, the
     * Okta Verify device enrolled on her account.
     */
    142: [
      ...series(
        142,
        1,
        412,
        ago(3 * HOUR + 12 * MINUTE),
        ago(9 * MINUTE),
        (index) => {
          const user = SPRAY_USERS[index % SPRAY_USERS.length];
          return {
            className: "Authentication",
            message: `user.session.start FAILURE: INVALID_CREDENTIALS for ${user} from ${SPRAY_IP}`,
            severityName: "Low",
            principalIp: SPRAY_IP,
            principalUser: user,
            targetResource: OKTA_ORG,
          };
        },
      ),
      event(142, 413, ago(41 * MINUTE), {
        className: "Authentication",
        message: `user.session.start SUCCESS for k.morgan@acme-commerce.example from ${SPRAY_IP}`,
        principalIp: SPRAY_IP,
        principalUser: "k.morgan@acme-commerce.example",
        targetResource: OKTA_ORG,
      }),
      event(142, 414, ago(25 * MINUTE), {
        className: "Account Change",
        message: `user.mfa.factor.activate: Okta Verify enrolled for k.morgan@acme-commerce.example from ${SPRAY_IP}`,
        severityName: "Medium",
        principalIp: SPRAY_IP,
        principalUser: "k.morgan@acme-commerce.example",
        targetResource: "Okta Verify (Pixel 8)",
      }),
    ],
    /*
     * The known-bad domain: build-runner-07 looked it up, and connected to
     * the address it resolved to, from just before the case opened to its
     * last detection - the eighteen events its triage read.
     */
    141: [
      ...series(
        141,
        1,
        12,
        ago(48 * MINUTE + 20 * 1000),
        ago(31 * MINUTE),
        () => {
          return {
            className: "DNS Activity",
            message:
              "dns.query update-sync.bad-cdn.example from build-runner-07",
            principalHost: "build-runner-07",
            targetResource: "update-sync.bad-cdn.example",
          };
        },
      ),
      ...series(
        141,
        13,
        6,
        ago(48 * MINUTE + 19 * 1000),
        ago(31 * MINUTE),
        () => {
          return {
            className: "Network Activity",
            message:
              "network.connection 198.51.100.23:443 from build-runner-07",
            principalHost: "build-runner-07",
            targetResource: "198.51.100.23:443",
          };
        },
      ),
    ],
    /*
     * The web shell: an encoded PowerShell command the IIS application pool
     * started on web-03, and what it ran next, as Defender XDR saw them.
     */
    138: [
      event(138, 1, ago(2 * HOUR + 1 * MINUTE + 48 * 1000), {
        className: "Process Activity",
        message:
          "powershell.exe -nop -w hidden -enc SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQAIABOAGUAdAAuAFcAZQBiAEMAbABpAGUAbgB0ACkA started by w3wp.exe",
        severityName: "High",
        principalHost: "web-03",
      }),
      event(138, 2, ago(2 * HOUR + 1 * MINUTE + 20 * 1000), {
        className: "Process Activity",
        message: "whoami.exe /all started by powershell.exe",
        severityName: "Medium",
        principalHost: "web-03",
      }),
      event(138, 3, ago(2 * HOUR + 55 * 1000), {
        className: "Process Activity",
        message: "net.exe user /domain started by powershell.exe",
        severityName: "Medium",
        principalHost: "web-03",
      }),
    ],
    // The credential dump: procdump against LSASS on fin-ws-112, twice an hour apart.
    140: [26 * HOUR + 2 * MINUTE, 25 * HOUR + 1 * MINUTE].map(
      (before, index) => {
        return event(140, index + 1, ago(before), {
          className: "Process Activity",
          message:
            "procdump64.exe -accepteula -ma lsass.exe C:\\Users\\Public\\lsass.dmp",
          severityName: "High",
          principalUser: "r.alvarez@acme-commerce.example",
          principalHost: "fin-ws-112",
        });
      },
    ),
    // The impossible travel: k.morgan signed in from two addresses within the half hour.
    139: [
      [7 * HOUR + 29 * MINUTE, "198.51.100.140"],
      [7 * HOUR + 1 * MINUTE, "192.0.2.180"],
    ].map(([before, address], index) => {
      return event(139, index + 1, ago(before), {
        className: "Authentication",
        message: `user.session.start SUCCESS for k.morgan@acme-commerce.example from ${address}`,
        principalIp: address,
        principalUser: "k.morgan@acme-commerce.example",
        targetResource: OKTA_ORG,
      });
    }),
    // The admin API key deploy-bot created outside the change window.
    137: [
      event(137, 1, ago(5 * HOUR + 1 * MINUTE), {
        className: "Account Change",
        message:
          "Admin API key release-2026-10-14 created by deploy-bot@acme-commerce.example",
        severityName: "Medium",
        principalUser: "deploy-bot@acme-commerce.example",
        targetResource: "release-2026-10-14",
      }),
    ],
    // The test attack (Get started): twelve failed SSH sign-ins from one address.
    150: series(
      150,
      1,
      12,
      ago(1 * MINUTE + 22 * 1000),
      ago(1 * MINUTE),
      () => {
        return {
          className: "Authentication",
          message:
            "sshd[4242]: Failed password for setup-test-user from 203.0.113.77 port 52314 ssh2",
          severityName: "Low",
          principalIp: "203.0.113.77",
          principalUser: "setup-test-user",
        };
      },
    ),
  };

  /*
   * ---------------------------------------------------------------------------
   * What the rest of OneUptime knows of the records, by name
   * ---------------------------------------------------------------------------
   */
  // One connection on the service map, as the topology read answers it.
  const mapped = (otherKey, otherName, otherType, callCount, errorCount) => {
    return {
      relationshipType: "calls",
      direction: "out",
      otherKey,
      otherKnown: otherType !== "External",
      otherName,
      otherType,
      callCount,
      errorCount,
      avgDurationMs: null,
      lastSeenAt: null,
    };
  };

  const RECORD_FACTS = {
    "build-runner-07": {
      owners: {
        teams: [{ id: ids.team(2), name: "Platform Engineering" }],
        users: [],
      },
      // Its week on the service map: what it called, and what called it.
      calls: [
        mapped(
          "service:artifact-registry",
          "artifact-registry",
          "Service",
          1840,
          0,
        ),
        mapped("external:github.com", "github.com", "External", 312, 2),
      ],
      calledBy: [
        mapped("service:ci-scheduler", "ci-scheduler", "Service", 96, 0),
      ],
      runsOn: [],
      // Before the case, beside the fix Connected Signals lists in its window.
      changes: [
        {
          id: contextId(1),
          time: ago(2 * DAY + 3 * HOUR).toISOString(),
          title: "Deployed runner image 2026.10.2",
          eventType: "deploy",
          version: "2026.10.2",
        },
      ],
      raised: { "ALR-311": ago(46 * MINUTE) },
    },
    "web-03": {
      owners: {
        teams: [{ id: ids.team(3), name: "Web Platform" }],
        users: [],
      },
      // The release the web shell came in after.
      changes: [
        {
          id: contextId(2),
          time: ago(5 * HOUR).toISOString(),
          title: "Deployed checkout 4.12.0",
          eventType: "deploy",
          version: "4.12.0",
        },
      ],
      raised: { "INC-1042": ago(1 * HOUR + 48 * MINUTE) },
    },
  };

  // The monitors each status page shows, by the page's name and the monitor's.
  const STATUS_PAGE_MONITORS = {
    "Acme Commerce Status": ["Checkout API"],
    "Engineering Tools": ["build-runner-07 heartbeat"],
  };

  /*
   * ---------------------------------------------------------------------------
   * Reading around a case
   * ---------------------------------------------------------------------------
   */
  function windowOf(securityCase) {
    return getCaseConnectionWindow({
      firstDetectedAt: securityCase.firstDetectedAt,
      lastDetectedAt: securityCase.lastDetectedAt,
      createdAt: securityCase.createdAt,
      now,
    });
  }

  const isIn = (time, window) => {
    const at = new Date(time).getTime();
    return at >= window.start.getTime() && at <= window.end.getTime();
  };

  // The case's own rows of a table, oldest first by `sortKey`.
  function rowsOfCase(modelType, securityCase, sortKey) {
    return table(modelType)
      .filter((row) => {
        return String(row.securityCaseId) === String(securityCase._id);
      })
      .sort((a, b) => {
        return new Date(a[sortKey]).getTime() - new Date(b[sortKey]).getTime();
      });
  }

  // Rows read one past their bound: the bound's worth, the cut remembered.
  function bound(rows, max, source, truncated) {
    if (rows.length > max) {
      truncated.add(source);
      return rows.slice(0, max);
    }
    return rows;
  }

  // The events naming the case's entities, in its window, oldest first.
  function eventsOf(securityCase, window) {
    return (CASE_EVENTS[securityCase.caseNumber] || [])
      .filter((row) => {
        return isIn(row.time, window);
      })
      .sort((a, b) => {
        return a.time.getTime() - b.time.getTime();
      });
  }

  function failed(status, message) {
    return { status, body: { message } };
  }

  function readCase(body) {
    if (typeof body?.caseId !== "string") {
      return { error: failed(400, "A valid case ID is required.") };
    }
    const securityCase = findCase(body.caseId);
    return securityCase
      ? { securityCase }
      : { error: failed(404, "This case could not be found.") };
  }

  /*
   * ---------------------------------------------------------------------------
   * Story
   * ---------------------------------------------------------------------------
   */
  function milestoneItems(securityCase) {
    const items = [];
    const opened = iso(securityCase.createdAt);
    if (opened) {
      items.push({
        key: "case:opened",
        kind: SecurityCaseStoryItemKind.CaseOpened,
        time: opened,
        title: "",
        links: {},
      });
    }
    for (const [milestone, value] of [
      [SecurityCaseStoryMilestone.Acknowledged, securityCase.acknowledgedAt],
      [SecurityCaseStoryMilestone.Contained, securityCase.containedAt],
      [SecurityCaseStoryMilestone.Closed, securityCase.closedAt],
    ]) {
      const time = iso(value);
      if (time) {
        items.push({
          key: `case:${milestone.toLowerCase()}`,
          kind: SecurityCaseStoryItemKind.Milestone,
          time,
          title: "",
          milestone,
          links: {},
        });
      }
    }
    return items;
  }

  function toDetectionItem(detection) {
    const id = String(detection._id || "");
    const first =
      iso(detection.firstSeenAt) ||
      iso(detection.createdAt) ||
      new Date(0).toISOString();
    const last = iso(detection.lastSeenAt);
    const item = {
      key: `detection:${id}`,
      kind: SecurityCaseStoryItemKind.Detection,
      time: first,
      title: cutStoryText(detection.title || detection.ruleName || ""),
      count: detection.fireCount || 1,
      links: {
        detectionId: id,
        ...(detection.eventUid ? { eventUid: detection.eventUid } : {}),
        ...(detection.groupValue ? { observable: detection.groupValue } : {}),
      },
    };
    if (last && new Date(last).getTime() > new Date(first).getTime()) {
      item.endTime = last;
    }
    if (detection.severity) {
      item.severityName = detection.severity;
    }
    if (detection.groupValue) {
      item.detail = cutStoryText(detection.groupValue);
    }
    return item;
  }

  const nameOf = (user) => {
    return user?.name?.toString() || user?.email?.toString() || "";
  };

  function toPlaybookRunItem(run) {
    const id = String(run._id || "");
    const actor = nameOf(run.triggeredByUser);
    return {
      key: `run:${id}`,
      kind: SecurityCaseStoryItemKind.PlaybookRun,
      time: iso(run.createdAt) || new Date(0).toISOString(),
      title: cutStoryText(run.playbookName || ""),
      ...(run.status
        ? {
            stateName: run.status,
            stateColor: getSecurityPlaybookRunStatusColor(
              run.status,
            ).toString(),
          }
        : {}),
      ...(actor ? { actorName: actor } : {}),
      links: { playbookRunId: id },
    };
  }

  function toNoteItem(note) {
    const actor = nameOf(note.createdByUser);
    return {
      key: `note:${String(note._id || "")}`,
      kind: SecurityCaseStoryItemKind.Note,
      time: iso(note.createdAt) || new Date(0).toISOString(),
      title: firstLine(note.note),
      ...(actor ? { actorName: actor } : {}),
      links: {},
    };
  }

  const resourceLink = (resource) => {
    return { kind: resource.kind, id: resource.id, name: resource.name };
  };

  // What changed on the case's records in its window: what Connected Signals lists.
  function changeItems(resources, window) {
    return resources.flatMap((resource) => {
      return (resource.recentChanges || [])
        .filter((change) => {
          return isIn(change.time, window);
        })
        .map((change) => {
          return {
            key: `change:${change.id || change.time}`,
            kind: SecurityCaseStoryItemKind.Change,
            time: new Date(change.time).toISOString(),
            title: cutStoryText(change.title || change.eventType || "Change"),
            ...(change.version ? { detail: cutStoryText(change.version) } : {}),
            stateName: change.eventType || "change",
            links: { resource: resourceLink(resource) },
          };
        });
    });
  }

  /*
   * The incidents and alerts raised on the case's records in its window: the
   * ones Connected Signals lists open on them, at the time each was raised.
   */
  function raisedItems(resources, window) {
    return resources.flatMap((resource) => {
      const raised = RECORD_FACTS[resource.name]?.raised || {};
      return [
        [SecurityCaseStoryItemKind.Incident, resource.activeIncidents],
        [SecurityCaseStoryItemKind.Alert, resource.activeAlerts],
      ].flatMap(([kind, list]) => {
        return (list?.items || [])
          .filter((item) => {
            return raised[item.number] && isIn(raised[item.number], window);
          })
          .map((item) => {
            const isIncident = kind === SecurityCaseStoryItemKind.Incident;
            return {
              key: `${isIncident ? "incident" : "alert"}:${item.id}`,
              kind,
              time: raised[item.number].toISOString(),
              title: cutStoryText(item.title || ""),
              ...(item.number ? { number: item.number } : {}),
              ...(item.stateName ? { stateName: item.stateName } : {}),
              ...(item.stateColor ? { stateColor: item.stateColor } : {}),
              links: {
                ...(isIncident
                  ? { incidentId: item.id }
                  : { alertId: item.id }),
                resource: resourceLink(resource),
              },
            };
          });
      });
    });
  }

  function story(body) {
    const read = readCase(body);
    if (read.error) {
      return read.error;
    }
    const securityCase = read.securityCase;
    const window = windowOf(securityCase);
    const resources = connections.forCase(securityCase).resources || [];
    const truncated = new Set();

    const detections = bound(
      rowsOfCase(SecurityDetection, securityCase, "firstSeenAt"),
      SECURITY_CASE_STORY_MAX_DETECTIONS,
      SecurityCaseStorySource.Detections,
      truncated,
    );
    const events = bound(
      eventsOf(securityCase, window),
      SECURITY_CASE_STORY_MAX_EVENTS,
      SecurityCaseStorySource.Events,
      truncated,
    );
    const runs = bound(
      rowsOfCase(SecurityPlaybookRun, securityCase, "createdAt"),
      SECURITY_CASE_STORY_MAX_PLAYBOOK_RUNS,
      SecurityCaseStorySource.PlaybookRuns,
      truncated,
    );
    const notes = bound(
      rowsOfCase(SecurityCaseNote, securityCase, "createdAt"),
      SECURITY_CASE_STORY_MAX_NOTES,
      SecurityCaseStorySource.Notes,
      truncated,
    );

    const items = [
      ...milestoneItems(securityCase),
      ...detections.map(toDetectionItem),
      ...runStoryEvents(events),
      ...buildStoryExceptionItems(events),
      ...changeItems(resources, window),
      ...raisedItems(resources, window),
      ...runs.map(toPlaybookRunItem),
      ...notes.map(toNoteItem),
    ];
    const merged = mergeStoryItems(items, SECURITY_CASE_STORY_MAX_ITEMS);
    if (merged.isTruncated) {
      const kept = new Set(
        merged.items.map((item) => {
          return item.key;
        }),
      );
      for (const item of items) {
        if (SOURCE_OF_KIND[item.kind] && !kept.has(item.key)) {
          truncated.add(SOURCE_OF_KIND[item.kind]);
        }
      }
    }

    return {
      status: 200,
      body: {
        windowStart: window.start.toISOString(),
        windowEnd: window.end.toISOString(),
        items: merged.items,
        truncatedSources: Array.from(truncated),
        unreadableSources: [],
        failedSources: [],
      },
    };
  }

  /*
   * ---------------------------------------------------------------------------
   * Impact
   * ---------------------------------------------------------------------------
   */
  // The addresses a case names, each once, in one spelling.
  function caseAddresses(securityCase) {
    const addresses = [];
    for (const entity of securityCase.entities || []) {
      const address =
        entity.type === SecurityEntityType.IpAddress
          ? canonicalAddress(entity.value)
          : null;
      if (address && !addresses.includes(address)) {
        addresses.push(address);
      }
    }
    return addresses;
  }

  /*
   * Requests from the case's addresses whose traces show they reached the
   * app: the first time each address got each far, as the server groups them.
   */
  function reachedRequests(events, addresses) {
    const reached = new Map();
    for (const row of events) {
      if (
        !addresses.includes(canonicalAddress(row.principalIp)) ||
        getRequestOutcomeRank(row.requestOutcome) <
          getRequestOutcomeRank(SecurityEventRequestOutcome.ReachedApp)
      ) {
        continue;
      }
      const key = `${row.principalIp}|${row.requestOutcome}`;
      if (!reached.has(key) || row.time < reached.get(key).time) {
        reached.set(key, {
          address: row.principalIp,
          time: row.time,
          requestOutcome: row.requestOutcome,
        });
      }
    }
    return Array.from(reached.values());
  }

  // The addresses the case's hosts report for themselves.
  function recordAddresses(resources) {
    return resources.flatMap((resource) => {
      const host =
        resource.kind === SecurityConnectionKind.Host
          ? connections.hosts.find((candidate) => {
              return candidate.id === resource.id;
            })
          : undefined;
      return host
        ? readRecordAddresses(host.addresses).map((address) => {
            return { recordName: host.name, address };
          })
        : [];
    });
  }

  // A record's changes from the week before the case's window to its end.
  function changesOf(resource, window) {
    const since = window.start.getTime() - CHANGE_LOOKBACK_IN_DAYS * DAY;
    return [
      ...(resource.recentChanges || []),
      ...(RECORD_FACTS[resource.name]?.changes || []),
    ].filter((change) => {
      const at = new Date(change.time).getTime();
      return at >= since && at <= window.end.getTime();
    });
  }

  // The project's status pages that show a monitor watching one of the records.
  function statusPagesOf(resources) {
    const monitors = resources.flatMap((resource) => {
      return resource.monitors?.items || [];
    });
    const pages = [];
    for (const row of table(StatusPage)) {
      const shown = monitors.filter((monitor) => {
        return (STATUS_PAGE_MONITORS[row.name] || []).includes(monitor.title);
      });
      if (shown.length > 0) {
        pages.push({
          id: String(row._id),
          name: row.name,
          monitorIds: Array.from(
            new Set(
              shown.map((monitor) => {
                return monitor.id;
              }),
            ),
          ),
        });
      }
    }
    return pages
      .sort((a, b) => {
        return a.name.localeCompare(b.name);
      })
      .slice(0, SECURITY_CASE_IMPACT_MAX_STATUS_PAGES);
  }

  function impact(body) {
    const read = readCase(body);
    if (read.error) {
      return read.error;
    }
    const securityCase = read.securityCase;
    const window = windowOf(securityCase);
    const firstDetectedAt = iso(securityCase.firstDetectedAt);
    const records = connections.forCase(securityCase);
    const resources = records.resources || [];
    const addresses = caseAddresses(securityCase).slice(
      0,
      SECURITY_CASE_IMPACT_MAX_FLOW_ADDRESSES,
    );

    return {
      status: 200,
      body: {
        windowStart: window.start.toISOString(),
        windowEnd: window.end.toISOString(),
        firstDetectedAt,
        records: resources.map((resource) => {
          const facts = RECORD_FACTS[resource.name] || {};
          // On the service map only with an inventory item to read it by.
          const onMap = (rows) => {
            return resource.inventoryItemId ? toImpactPeers(rows || []) : null;
          };
          return {
            kind: resource.kind,
            id: resource.id,
            name: resource.name,
            certainty: resource.certainty,
            ...(resource.inventoryItemId
              ? { inventoryItemId: resource.inventoryItemId }
              : {}),
            calls: onMap(facts.calls),
            calledBy: onMap(facts.calledBy),
            runsOn: onMap(facts.runsOn),
            monitors: resource.monitors || null,
            owners: OWNED_KINDS.includes(resource.kind)
              ? facts.owners || { teams: [], users: [] }
              : null,
            lastChange: UNCHANGED_KINDS.includes(resource.kind)
              ? null
              : pickLastChange(
                  changesOf(resource, window),
                  firstDetectedAt ? new Date(firstDetectedAt) : null,
                ),
          };
        }),
        hasMoreRecords: Boolean(records.hasMoreResources),
        statusPages: statusPagesOf(resources),
        // No network flows arrive in this project.
        flowPeers: [],
        internet: buildInternetExposure({
          requests: reachedRequests(eventsOf(securityCase, window), addresses),
          recordAddresses: recordAddresses(resources),
        }),
        unreadableSources:
          (records.unreadableKinds || []).length > 0
            ? [SecurityCaseImpactSource.Records]
            : [],
        failedSources:
          (records.failedKinds || []).length > 0
            ? [SecurityCaseImpactSource.Records]
            : [],
      },
    };
  }

  return { story, impact };
}
