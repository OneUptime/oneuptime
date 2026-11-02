/*
 * Where what a case, an event or an entity names appears in the project's
 * logs and traces: what POST /security-case/connections/telemetry answers,
 * worked out the way the server works it out (Common/Server/Utils/
 * SecurityEvent/Connections/SecurityTelemetryMentions) - on a handful of
 * log lines and spans of the fixture's own, with the same rules, imported
 * from Common/Utils/SecurityCase/SecurityTelemetrySearch: which values are
 * searched for, the pattern a message names one by (here run as a
 * JavaScript RegExp of the very same pattern, which ClickHouse runs as
 * RE2), the spellings an attribute is held to, and where in them it was.
 *
 * The lines and spans, all made up (documentation addresses, example
 * domains), each standing for as many alike as its count says:
 *
 *   okta-gateway   1,200 failed sign-ins from the spray's 203.0.113.47 in
 *                  their message, 84 more with it as client_ip
 *   waf            20 rule matches naming it
 *   (unnamed)      40 lines of a service the reader cannot name: counted,
 *                  never listed
 *   build-runner-07  18 DNS lookups of update-sync.bad-cdn.example
 *   egress-proxy   6 CONNECTs to it from 198.51.100.23; 2 spans holding it
 *                  in upper case as server.address
 *   auth           3 sessions of k.morgan@acme-commerce.example as
 *                  user.email; 312 spans of the spray as client.address
 *                  (300) and net.peer.ip (12)
 *   nginx          60 access lines of 203.0.113.30 (web-03)
 *   checkout-api   5 spans of k.morgan@acme-commerce.example as enduser.id
 *
 * and near misses the rules leave out: 203.0.113.470, 1203.0.113.47,
 * sub.update-sync.bad-cdn.example and a resource attribute holding the
 * runner's address.
 *
 * Scenarios (?telemetry=):
 *   fail      the first read fails (a 500); the section's Refresh reads it
 *   limited   the reader's role cannot read logs, and the traces could not
 *             be searched this time (Try again searches them); the next
 *             read answers in full
 */
import {
  getCaseConnectionWindow,
  getEventConnectionWindow,
} from "Common/Utils/SecurityCase/SecurityConnectionMatch";
import {
  RE2_CASE_INSENSITIVE_FLAG,
  getTelemetryPlaces,
  getTelemetrySearchValues,
  isResourceAttributeKey,
} from "Common/Utils/SecurityCase/SecurityTelemetrySearch";
import {
  SECURITY_TELEMETRY_MAX_LISTED,
  SecurityConnectionKind,
  SecurityTelemetrySignal,
} from "Common/Types/SecurityCase/SecurityConnection";

export const TELEMETRY_SCENARIOS = ["fail", "limited"];

export const TELEMETRY_SPRAY_IP = "203.0.113.47";

export function createTelemetryMentionsFixture(options) {
  const { now, uuid, scenario, findCase, runnerHostId } = options;
  const serviceId = (n) => {
    return uuid("2f000000", n);
  };

  const SOURCES = {
    oktaGateway: {
      kind: SecurityConnectionKind.Service,
      type: "OpenTelemetry",
      id: serviceId(1),
      name: "okta-gateway",
    },
    waf: {
      kind: SecurityConnectionKind.Service,
      type: "OpenTelemetry",
      id: serviceId(2),
      name: "waf",
    },
    egressProxy: {
      kind: SecurityConnectionKind.Service,
      type: "OpenTelemetry",
      id: serviceId(3),
      name: "egress-proxy",
    },
    auth: {
      kind: SecurityConnectionKind.Service,
      type: "OpenTelemetry",
      id: serviceId(4),
      name: "auth",
    },
    nginx: {
      kind: SecurityConnectionKind.Service,
      type: "OpenTelemetry",
      id: serviceId(5),
      name: "nginx",
    },
    checkoutApi: {
      kind: SecurityConnectionKind.Service,
      type: "OpenTelemetry",
      id: serviceId(6),
      name: "checkout-api",
    },
    // A service the reader cannot name: counted, never listed.
    unnamed: {
      kind: SecurityConnectionKind.Service,
      type: "OpenTelemetry",
      id: serviceId(9),
      name: "",
    },
    runner: {
      kind: SecurityConnectionKind.Host,
      type: "Host",
      id: runnerHostId,
      name: "build-runner-07",
    },
  };

  const SPRAY = TELEMETRY_SPRAY_IP;
  const DOMAIN = "update-sync.bad-cdn.example";
  const KAI = "k.morgan@acme-commerce.example";

  const LOG_LINES = [
    {
      source: SOURCES.oktaGateway,
      body: `Failed sign-in from ${SPRAY}: invalid credentials`,
      count: 1200,
    },
    {
      source: SOURCES.oktaGateway,
      body: "POST /api/v1/authn 401",
      attributes: { client_ip: SPRAY },
      count: 84,
    },
    {
      source: SOURCES.waf,
      body: `Rule 942100 matched from ${SPRAY}`,
      count: 20,
    },
    { source: SOURCES.unnamed, body: `blocked ${SPRAY}`, count: 40 },
    // Near misses: a longer number, a longer address.
    {
      source: SOURCES.waf,
      body: `Rule 942100 matched from ${SPRAY}0`,
      count: 7,
    },
    { source: SOURCES.waf, body: `from 1${SPRAY}`, count: 3 },
    {
      source: SOURCES.runner,
      body: `query[A] ${DOMAIN} from 10.20.0.7`,
      count: 18,
    },
    // A longer name is another name.
    {
      source: SOURCES.runner,
      body: `query[A] sub.${DOMAIN} from 10.20.0.7`,
      count: 4,
    },
    {
      source: SOURCES.egressProxy,
      body: `CONNECT ${DOMAIN}:443 from 198.51.100.23`,
      count: 6,
    },
    // Who sent a line says nothing of what it says.
    {
      source: SOURCES.runner,
      body: "heartbeat",
      attributes: { "resource.host.ip": "198.51.100.23" },
      count: 120,
    },
    {
      source: SOURCES.auth,
      body: "Session started",
      attributes: { "user.email": KAI },
      count: 3,
    },
    {
      source: SOURCES.nginx,
      body: '203.0.113.30 - - "GET /healthz HTTP/1.1" 200',
      count: 60,
    },
  ];

  const SPANS = [
    {
      source: SOURCES.auth,
      attributes: { "client.address": SPRAY, "http.route": "/api/v1/authn" },
      count: 300,
    },
    { source: SOURCES.auth, attributes: { "net.peer.ip": SPRAY }, count: 12 },
    {
      source: SOURCES.egressProxy,
      attributes: { "server.address": DOMAIN.toUpperCase() },
      count: 2,
    },
    {
      source: SOURCES.checkoutApi,
      attributes: { "enduser.id": KAI },
      count: 5,
    },
  ];

  let reads = 0;

  // One value's hits among some lines or spans, as the server counts them.
  function hitsOf(rows, value, readsMessage, window) {
    /*
     * The value's own pattern, every character of the value escaped where it
     * was built (getTelemetryMessagePattern), and its time linear in the
     * line: no repeat in it but the one-character edges.
     */
    const pattern = readsMessage
      ? new RegExp(
          value.messagePattern.slice(RE2_CASE_INSENSITIVE_FLAG.length),
          "i",
        )
      : null;
    let count = 0;
    let messageCount = 0;
    const bySource = new Map();
    const byKey = new Map();

    for (const row of rows) {
      const inMessage = Boolean(pattern && row.body && pattern.test(row.body));
      const keys = Object.entries(row.attributes || {}).filter(
        ([key, held]) => {
          return !isResourceAttributeKey(key) && value.spellings.includes(held);
        },
      );

      if (!inMessage && keys.length === 0) {
        continue;
      }

      count += row.count;

      if (inMessage) {
        messageCount += row.count;
      }

      bySource.set(row.source, (bySource.get(row.source) || 0) + row.count);

      for (const [key, held] of keys) {
        const known = byKey.get(key) || { key, count: 0, value: held };
        known.count += row.count;
        byKey.set(key, known);
      }
    }

    const ranked = Array.from(bySource.entries()).sort((a, b) => {
      return b[1] - a[1];
    });

    return {
      count,
      sources: ranked
        .filter(([source]) => {
          return Boolean(source.name);
        })
        .slice(0, SECURITY_TELEMETRY_MAX_LISTED)
        .map(([source, sourceCount]) => {
          return {
            kind: source.kind,
            id: source.id,
            name: source.name,
            count: sourceCount,
          };
        }),
      sourceCount: ranked.length,
      places: getTelemetryPlaces({
        messageCount,
        attributeKeys: Array.from(byKey.values()),
      }),
      lastSeen: count > 0 ? window.end.toISOString() : null,
    };
  }

  function build(entities, window, limits) {
    const search = getTelemetrySearchValues(entities);
    const unreadableSignals = limits ? [SecurityTelemetrySignal.Logs] : [];
    const failedSignals = limits ? [SecurityTelemetrySignal.Traces] : [];

    return {
      windowStart: window.start.toISOString(),
      windowEnd: window.end.toISOString(),
      values:
        search.values.length === 0
          ? []
          : search.values.map((value) => {
              return {
                entityType: value.entity.type,
                entityValue: value.entity.value,
                logs: limits ? null : hitsOf(LOG_LINES, value, true, window),
                traces: limits ? null : hitsOf(SPANS, value, false, window),
              };
            }),
      hasMoreValues: search.hasMoreValues,
      unreadableSignals: search.values.length > 0 ? unreadableSignals : [],
      failedSignals: search.values.length > 0 ? failedSignals : [],
    };
  }

  // The route: a case's values around its detections, or an event's or an entity's around a time.
  function answer(body) {
    reads++;

    if (scenario === "fail" && reads === 1) {
      return { status: 500, body: { message: "Server Error" } };
    }

    const limits = scenario === "limited" && reads === 1;

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
          getCaseConnectionWindow({
            firstDetectedAt: securityCase.firstDetectedAt,
            lastDetectedAt: securityCase.lastDetectedAt,
            createdAt: securityCase.createdAt,
            now,
          }),
          limits,
        ),
      };
    }

    const entities = Array.isArray(body?.entities) ? body.entities : [];
    const time = body?.time ? new Date(body.time) : null;
    const at = time && time.getTime() <= now.getTime() ? time : now;

    return {
      status: 200,
      body: build(entities, getEventConnectionWindow(at, now), limits),
    };
  }

  return { answer, sources: SOURCES };
}
