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

export const CONNECTION_SCENARIOS = ["fail", "partial"];

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
          },
        ],
      },
      monitors: {
        count: 1,
        items: [{ id: factId(2), title: "build-runner-07 heartbeat" }],
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

  function resolve(entities, logResources) {
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
    const isPartial = scenario === "partial" && reads === 1;
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

  function build(entities, logResources, window) {
    const resolved = resolve(entities, logResources);
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
   * The route: a case's connections around its detections, or an event's or
   * an entity's values around a time (the hour around it, ending by now).
   */
  function answer(body) {
    reads++;

    if (scenario === "fail" && reads === 1) {
      return { status: 500, body: { message: "Server Error" } };
    }

    if (body && typeof body.caseId === "string") {
      const securityCase = findCase(body.caseId);
      if (!securityCase) {
        return {
          status: 404,
          body: { message: "This case could not be found." },
        };
      }
      return {
        status: 200,
        body: build(
          securityCase.entities || [],
          CASE_LOG_RESOURCES[securityCase.caseNumber] || [],
          getCaseConnectionWindow({
            firstDetectedAt: securityCase.firstDetectedAt,
            lastDetectedAt: securityCase.lastDetectedAt,
            createdAt: securityCase.createdAt,
            now,
          }),
        ),
      };
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
      ),
    };
  }

  return { answer, hosts: HOSTS, members: MEMBERS };
}
