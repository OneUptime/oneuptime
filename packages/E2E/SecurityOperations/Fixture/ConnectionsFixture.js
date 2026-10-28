/*
 * Security Events' connections to the rest of OneUptime, on the fixture's
 * own records: what POST /security-case/connections answers for a case's
 * Connected Signals page and an entity's page, worked out the way the
 * server works it out (Common/Server/Utils/SecurityEvent/Connections/
 * SecurityConnectedRecords) - with the same rules, imported from
 * Common/Utils/SecurityCase/SecurityConnectionMatch, so an exact match here
 * is one there.
 *
 * The project's records, all made up (documentation addresses, example
 * domains):
 *
 *   build-runner-07   a host at 198.51.100.23 (public) and 10.20.0.7; its
 *                     own logs carry the DNS lookups CASE-141 was read from;
 *                     an alert open on it, a monitor, and a fix in the hour
 *   web-03            a host at 203.0.113.30, two incidents open on it and
 *                     three monitors
 *   web-03.staging.acme-commerce.example
 *                     a host CASE-138's "web-03" only possibly names
 *   fin-ws-112.corp.acme-commerce.example
 *                     a host CASE-140's "fin-ws-112" only possibly names
 *   Kai Morgan        a member, k.morgan@acme-commerce.example, whose Okta
 *                     account is one of the spray's targets
 *
 * Scenarios (?connections=):
 *   fail      the first read fails (a 500); Try again reads it
 *   partial   the reader's role cannot read users, and the Kubernetes
 *             clusters could not be read this time - so no email or name is
 *             said to be not in OneUptime; the next read answers in full
 *   busy      a case's page names one of every kind of record, every fact a
 *             record can have, possible matches, more records than are
 *             shown and values OneUptime does not know (busyAnswer)
 */
import {
  canonicalAddress,
  compareConnectedResources,
  getBestCertainty,
  getCaseConnectionWindow,
  getEventConnectionWindow,
  getSecurityConnectionLookups,
  matchAddress,
  matchEmail,
  matchHostName,
  readRecordAddresses,
  wasLookedUpEverywhere,
} from "Common/Utils/SecurityCase/SecurityConnectionMatch";
import {
  SECURITY_CONNECTION_MAX_RESOURCES,
  SecurityConnectionCertainty,
  SecurityConnectionKind,
  SecurityConnectionReason,
} from "Common/Types/SecurityCase/SecurityConnection";
import { SecurityEntityType } from "Common/Types/SecurityCase/SecurityEntity";

export const CONNECTION_SCENARIOS = ["fail", "partial", "busy"];

export function createConnectionsFixture(options) {
  const { now, uuid, MINUTE, findCase, scenario } = options;
  const ago = (milliseconds) => {
    return new Date(now.getTime() - milliseconds);
  };
  const recordId = (n) => {
    return uuid("2d000000", n);
  };
  const factId = (n) => {
    return uuid("2e000000", n);
  };

  const HOSTS = [
    {
      id: recordId(1),
      name: "build-runner-07",
      addresses: "198.51.100.23, 10.20.0.7",
      inventoryItemId: recordId(101),
    },
    { id: recordId(2), name: "web-03", addresses: "203.0.113.30" },
    {
      id: recordId(3),
      name: "web-03.staging.acme-commerce.example",
      addresses: "10.40.3.3",
    },
    {
      id: recordId(4),
      name: "fin-ws-112.corp.acme-commerce.example",
      addresses: "10.12.0.112",
    },
  ];

  const MEMBERS = [
    {
      id: uuid("80000000", 21),
      name: "Kai Morgan",
      email: "k.morgan@acme-commerce.example",
    },
  ];

  const empty = () => {
    return { count: 0, items: [] };
  };

  // What is going on on each host, as the server reads it for the window.
  const HOST_FACTS = {
    [recordId(1)]: {
      activeIncidents: empty(),
      activeAlerts: {
        count: 1,
        items: [
          {
            id: factId(1),
            number: "ALR-311",
            title: "Outbound DNS to a threat feed domain",
            stateName: "Acknowledged",
            stateColor: "#ffbf53",
          },
        ],
      },
      monitors: {
        count: 1,
        items: [
          {
            id: factId(2),
            title: "build-runner-07 heartbeat",
            stateName: "Operational",
            stateColor: "#2ab57d",
          },
        ],
      },
      recentChanges: [
        {
          id: factId(3),
          time: ago(36 * MINUTE).toISOString(),
          title: "Fixed: rotated the runner's registration token",
          eventType: "fix",
        },
      ],
    },
    [recordId(2)]: {
      activeIncidents: {
        count: 2,
        items: [
          {
            id: factId(4),
            number: "INC-1042",
            title: "Checkout returns 502s",
            stateName: "Investigating",
            stateColor: "#f97316",
          },
        ],
      },
      activeAlerts: empty(),
      monitors: {
        count: 3,
        items: [
          { id: factId(5), title: "web-03 ping" },
          { id: factId(6), title: "Checkout API" },
        ],
      },
      recentChanges: [],
    },
  };

  // The logs behind each case's events, by the record they were sent under.
  const CASE_LOG_RESOURCES = {
    141: [{ type: "Host", id: recordId(1) }],
  };

  let reads = 0;

  /*
   * ?connections=busy: a case that names one of every kind of record, the
   * exact ones with every fact a record can have - more incidents, alerts
   * and monitors than are listed, three changes, long titles - and four
   * possible matches after them, more records than are shown, and four
   * values OneUptime does not know. What the page must keep readable at
   * every width: one item a line, the labels beside the items from 36rem of
   * a record's width and above them below it, nothing past the card.
   */
  function busyAnswer(window) {
    const fact = (n, number, title, stateName, stateColor) => {
      return {
        id: factId(100 + n),
        ...(number ? { number } : {}),
        title,
        ...(stateName ? { stateName, stateColor } : {}),
      };
    };
    const record = (kind, n, name, certainty, match, facts) => {
      return {
        kind,
        id: recordId(200 + n),
        name,
        certainty,
        matches: [{ ...match, certainty }],
        activeIncidents:
          facts.activeIncidents === undefined ? empty() : facts.activeIncidents,
        activeAlerts:
          facts.activeAlerts === undefined ? empty() : facts.activeAlerts,
        monitors: facts.monitors === undefined ? empty() : facts.monitors,
        recentChanges:
          facts.recentChanges === undefined ? [] : facts.recentChanges,
      };
    };
    const change = (n, minutesAgo, title, eventType) => {
      return {
        id: factId(150 + n),
        time: ago(minutesAgo * MINUTE).toISOString(),
        title,
        eventType,
      };
    };
    const named = (entityType, value, reason, matchedValue) => {
      return {
        entityType,
        entityValue: value,
        reason,
        matchedValue: matchedValue || value,
      };
    };
    const { Exact, Possible } = SecurityConnectionCertainty;

    return {
      windowStart: window.start.toISOString(),
      windowEnd: window.end.toISOString(),
      resources: [
        record(
          SecurityConnectionKind.Host,
          1,
          "checkout-web-01",
          Exact,
          named(
            SecurityEntityType.Host,
            "checkout-web-01",
            SecurityConnectionReason.HostName,
          ),
          {
            activeIncidents: {
              count: 4,
              items: [
                fact(
                  1,
                  "INC-1042",
                  "Checkout returns 502s for every customer paying with a saved card in the EU region",
                  "Investigating",
                  "#f97316",
                ),
                fact(
                  2,
                  "INC-1039",
                  "Card payments time out",
                  "Acknowledged",
                  "#ffbf53",
                ),
                fact(
                  3,
                  "INC-1031",
                  "Slow product search",
                  "Identified",
                  "#fd625e",
                ),
              ],
            },
            activeAlerts: {
              count: 2,
              items: [
                fact(
                  4,
                  "ALR-311",
                  "Outbound DNS to a threat feed domain",
                  "Acknowledged",
                  "#ffbf53",
                ),
                fact(
                  5,
                  "ALR-309",
                  "CPU above 90% for 10 minutes",
                  "Created",
                  "#fd625e",
                ),
              ],
            },
            monitors: {
              count: 5,
              items: [
                fact(6, "", "checkout-web-01 ping", "Operational", "#2ab57d"),
                fact(7, "", "Checkout API", "Degraded", "#ffbf53"),
                fact(
                  8,
                  "",
                  "checkout-web-01 disk space",
                  "Operational",
                  "#2ab57d",
                ),
              ],
            },
            recentChanges: [
              change(1, 95, "Deployed checkout 4.12.0", "deploy"),
              change(
                2,
                60,
                "Fixed: rotated the payment gateway's API key",
                "fix",
              ),
              change(
                3,
                30,
                "Changed nginx worker_connections from 1024 to 4096 on every web node of the EU checkout pool",
                "config",
              ),
            ],
          },
        ),
        record(
          SecurityConnectionKind.KubernetesCluster,
          2,
          "prod-eu-west-1",
          Exact,
          named(
            SecurityEntityType.Host,
            "prod-eu-west-1",
            SecurityConnectionReason.ClusterName,
          ),
          {
            activeIncidents: {
              count: 1,
              items: [
                fact(
                  9,
                  "INC-1040",
                  "Pods restarting in checkout",
                  "Investigating",
                  "#f97316",
                ),
              ],
            },
            recentChanges: [
              change(4, 70, "Rolled out checkout-api to 4.12.0", "rollout"),
            ],
          },
        ),
        record(
          SecurityConnectionKind.Service,
          3,
          "checkout-api",
          Exact,
          named(
            SecurityEntityType.Other,
            "checkout-api",
            SecurityConnectionReason.LogSource,
          ),
          {
            activeAlerts: {
              count: 1,
              items: [
                fact(
                  10,
                  "ALR-312",
                  "Error rate above 5%",
                  "Created",
                  "#fd625e",
                ),
              ],
            },
            recentChanges: [change(5, 95, "Deployed 4.12.0", "deploy")],
          },
        ),
        record(
          SecurityConnectionKind.NetworkDevice,
          4,
          "edge-fw-01",
          Exact,
          named(
            SecurityEntityType.Host,
            "edge-fw-01",
            SecurityConnectionReason.DeviceName,
          ),
          {
            monitors: {
              count: 1,
              items: [
                fact(11, "", "edge-fw-01 SNMP", "Operational", "#2ab57d"),
              ],
            },
          },
        ),
        {
          ...record(
            SecurityConnectionKind.User,
            5,
            "Kai Morgan",
            Exact,
            named(
              SecurityEntityType.User,
              "k.morgan@acme-commerce.example",
              SecurityConnectionReason.Email,
            ),
            {},
          ),
          id: MEMBERS[0].id,
          activeIncidents: null,
          activeAlerts: null,
          monitors: null,
          recentChanges: null,
        },
        record(
          SecurityConnectionKind.Host,
          6,
          "checkout-web-01.staging.acme-commerce.example",
          Possible,
          named(
            SecurityEntityType.Host,
            "checkout-web-01",
            SecurityConnectionReason.ShortHostName,
            "checkout-web-01.staging.acme-commerce.example",
          ),
          {},
        ),
        record(
          SecurityConnectionKind.PodmanHost,
          7,
          "lab-podman-01",
          Possible,
          named(
            SecurityEntityType.IpAddress,
            "10.40.3.9",
            SecurityConnectionReason.PrivateAddress,
          ),
          {},
        ),
        record(
          SecurityConnectionKind.Host,
          8,
          "db-replica-2",
          Possible,
          named(
            SecurityEntityType.Other,
            "db-replica-2",
            SecurityConnectionReason.UntypedValue,
          ),
          {},
        ),
        record(
          SecurityConnectionKind.DockerHost,
          9,
          "cache-docker-1",
          Possible,
          named(
            SecurityEntityType.IpAddress,
            "198.51.100.40",
            SecurityConnectionReason.SharedAddress,
          ),
          {},
        ),
      ],
      hasMoreResources: true,
      unmatched: [
        {
          type: SecurityEntityType.Domain,
          value: "update-sync.bad-cdn.example",
        },
        { type: SecurityEntityType.IpAddress, value: "45.33.32.156" },
        {
          type: SecurityEntityType.User,
          value:
            "svc-payments-reconciliation-batch-runner@acme-commerce-production.example",
        },
        { type: SecurityEntityType.Host, value: "kiosk-17" },
      ],
      unreadableKinds: [],
      failedKinds: [],
    };
  }

  function resolve(entities, logResources, isPartial) {
    const lookups = getSecurityConnectionLookups(entities);
    const records = new Map();
    const add = (kind, record, match) => {
      const key = `${kind}:${record.id}`;
      if (!records.has(key)) {
        records.set(key, {
          kind,
          id: record.id,
          name: record.name,
          matches: [],
        });
      }
      const found = records.get(key);
      const matchKey = `${match.entityValue.toLowerCase()}|${match.reason}`;
      if (
        !found.matches.some((known) => {
          return (
            `${known.entityValue.toLowerCase()}|${known.reason}` === matchKey
          );
        })
      ) {
        found.matches.push(match);
      }
    };

    // Names: each name the case gives, against each host's.
    for (const host of HOSTS) {
      for (const hostName of lookups.hostNames) {
        const entity = lookups.hostNameEntities.get(hostName) || {
          type: SecurityEntityType.Host,
          value: hostName,
        };
        const verdict = matchHostName({
          entityValue: hostName,
          entityType: entity.type,
          resourceName: host.name,
        });
        if (verdict) {
          add(SecurityConnectionKind.Host, host, {
            entityType: entity.type,
            entityValue: hostName,
            certainty: verdict.certainty,
            reason: verdict.reason,
            matchedValue: host.name,
          });
        }
      }
    }

    // Addresses: exact only when public and no other record holds it.
    for (const address of lookups.addresses) {
      const holders = HOSTS.filter((host) => {
        return readRecordAddresses(host.addresses).includes(address);
      });
      const verdict = matchAddress({ address, holderCount: holders.length });
      if (!verdict) {
        continue;
      }
      const entity = lookups.lookedUp.find((candidate) => {
        return canonicalAddress(candidate.value) === address;
      }) || { type: SecurityEntityType.IpAddress, value: address };
      for (const host of holders) {
        add(SecurityConnectionKind.Host, host, {
          entityType: entity.type,
          entityValue: entity.value,
          certainty: verdict.certainty,
          reason: verdict.reason,
          matchedValue: address,
        });
      }
    }

    // Members: by their email, and only when the role may read them.
    const unreadableKinds = isPartial ? [SecurityConnectionKind.User] : [];
    const failedKinds = isPartial
      ? [SecurityConnectionKind.KubernetesCluster]
      : [];
    if (!isPartial) {
      for (const email of lookups.emails) {
        for (const member of MEMBERS) {
          const verdict = matchEmail({
            entityValue: email,
            email: member.email,
          });
          if (verdict) {
            const entity = lookups.lookedUp.find((candidate) => {
              return candidate.value.toLowerCase() === email;
            });
            add(SecurityConnectionKind.User, member, {
              entityType: entity ? entity.type : SecurityEntityType.User,
              entityValue: entity ? entity.value : email,
              certainty: verdict.certainty,
              reason: verdict.reason,
              matchedValue: member.email,
            });
          }
        }
      }
    }

    // The records the events' log lines were sent under.
    for (const resource of logResources) {
      const host = HOSTS.find((candidate) => {
        return resource.type === "Host" && candidate.id === resource.id;
      });
      if (host) {
        add(SecurityConnectionKind.Host, host, {
          entityType: SecurityEntityType.Other,
          entityValue: host.name,
          certainty: SecurityConnectionCertainty.Exact,
          reason: SecurityConnectionReason.LogSource,
          matchedValue: host.name,
        });
      }
    }

    const all = Array.from(records.values()).map((record) => {
      record.matches.sort((a, b) => {
        if (a.certainty === b.certainty) {
          return 0;
        }
        return a.certainty === SecurityConnectionCertainty.Exact ? -1 : 1;
      });
      record.certainty = getBestCertainty(
        record.matches.map((match) => {
          return match.certainty;
        }),
      );
      return record;
    });
    all.sort(compareConnectedResources);

    const matchedValues = new Set();
    for (const record of all) {
      for (const match of record.matches) {
        matchedValues.add(match.entityValue.toLowerCase());
      }
    }

    const unsureKinds = new Set([...unreadableKinds, ...failedKinds]);

    return {
      records: all,
      unmatched: lookups.lookedUp.filter((entity) => {
        return (
          !matchedValues.has(entity.value.trim().toLowerCase()) &&
          wasLookedUpEverywhere(entity, unsureKinds)
        );
      }),
      unreadableKinds,
      failedKinds,
    };
  }

  function build(entities, logResources, window, isPartial) {
    const resolved = resolve(entities, logResources, isPartial);
    const shown = resolved.records.slice(0, SECURITY_CONNECTION_MAX_RESOURCES);

    return {
      windowStart: window.start.toISOString(),
      windowEnd: window.end.toISOString(),
      resources: shown.map((record) => {
        // A member has no incidents, alerts, monitors or changes of their own.
        const isHost = record.kind === SecurityConnectionKind.Host;
        const facts = isHost ? HOST_FACTS[record.id] : null;
        const host = HOSTS.find((candidate) => {
          return candidate.id === record.id;
        });
        return {
          kind: record.kind,
          id: record.id,
          name: record.name,
          certainty: record.certainty,
          matches: record.matches,
          activeIncidents: isHost ? facts?.activeIncidents || empty() : null,
          activeAlerts: isHost ? facts?.activeAlerts || empty() : null,
          monitors: isHost ? facts?.monitors || empty() : null,
          recentChanges: isHost ? facts?.recentChanges || [] : null,
          ...(host?.inventoryItemId
            ? { inventoryItemId: host.inventoryItemId }
            : {}),
        };
      }),
      hasMoreResources: resolved.records.length > shown.length,
      unmatched: resolved.unmatched,
      unreadableKinds: resolved.unreadableKinds,
      failedKinds: resolved.failedKinds,
    };
  }

  /*
   * A case's connections around its detections, as the route answers them
   * (`isPartial`: the role and a failed read keep kinds of record back).
   */
  function caseAnswer(securityCase, isPartial) {
    const window = getCaseConnectionWindow({
      firstDetectedAt: securityCase.firstDetectedAt,
      lastDetectedAt: securityCase.lastDetectedAt,
      createdAt: securityCase.createdAt,
      now,
    });
    if (scenario === "busy") {
      return busyAnswer(window);
    }
    return build(
      securityCase.entities || [],
      CASE_LOG_RESOURCES[securityCase.caseNumber] || [],
      window,
      isPartial,
    );
  }

  /*
   * The route: a case's connections around its detections, or an event's or
   * an entity's values around a time (the hour around it, ending by now).
   */
  function answer(body) {
    reads++;

    if (scenario === "fail" && reads === 1) {
      return { status: 500, body: { message: "Server Error" } };
    }
    const isPartial = scenario === "partial" && reads === 1;

    if (body && typeof body.caseId === "string") {
      const securityCase = findCase(body.caseId);
      if (!securityCase) {
        return {
          status: 404,
          body: { message: "This case could not be found." },
        };
      }
      return { status: 200, body: caseAnswer(securityCase, isPartial) };
    }

    const entities = Array.isArray(body?.entities) ? body.entities : [];
    const time = body?.time ? new Date(body.time) : null;
    const at = time && time.getTime() <= now.getTime() ? time : now;

    return {
      status: 200,
      body: build(
        entities,
        Array.isArray(body?.logResources) ? body.logResources : [],
        getEventConnectionWindow(at, now),
        isPartial,
      ),
    };
  }

  /*
   * A case's records, as the route lists them, for what the server reads
   * from them in reads of their own (a case's Story and Impact,
   * CaseContextFixture.js): not counted as the route's read, so ?connections=
   * fail and partial stay about Connected Signals.
   */
  function forCase(securityCase) {
    return caseAnswer(securityCase, false);
  }

  return { answer, forCase, hosts: HOSTS, members: MEMBERS };
}
