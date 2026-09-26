/*
 * The Topology API (POST /api/telemetry/topology/...), answered inside the
 * fixture page from its synthetic inventory. No database and no server: the
 * page's real transport (API.post, the decoders, formatVersion checks) talks
 * to this module exactly as it talks to the BaseAPI router.
 *
 * Two pieces of production-adjacent code keep the answers honest:
 *
 *   - Request bodies are parsed with the server's own TopologyRequest, so a
 *     request the real router would refuse (a malformed rangeStart, an
 *     unknown section, a collection of a structural type, ...) is refused
 *     here too, with the same 400.
 *   - The Service Map, Infrastructure and drawer payloads come from the
 *     reference implementation the server's SQL is differential-tested
 *     against (Common/Tests/Server/Utils/Topology/TopologyReference.ts):
 *     activity, item identity, relationships in range, nesting with the
 *     Common tables, placements, runs-on counts and drawer sections all follow
 *     the documented semantics rather than a fixture-only approximation.
 *
 * Collection pages and collection search are simple enough to compute here,
 * with the server's filters and keyset order.
 */
import BadDataException from "Common/Types/Exception/BadDataException";
import {
  TOPOLOGY_API_FORMAT_VERSION,
  TopologyApiPath,
} from "Common/Types/Topology/TopologyApi";
import TopologyRequest from "Common/Server/Utils/Topology/TopologyRequest";
import {
  compareCollateC,
  isReferenceActive,
  referenceEntity,
  referenceEpochMs,
  referenceInfrastructure,
  referenceServiceMap,
} from "Common/Tests/Server/Utils/Topology/TopologyReference";

function envelope(rangeStart) {
  return {
    formatVersion: TOPOLOGY_API_FORMAT_VERSION,
    rangeStart: rangeStart.toISOString(),
    generatedAt: new Date().toISOString(),
  };
}

function scope(estate, request) {
  return { projectId: estate.projectId, rangeStart: request.rangeStart };
}

function leanEntity(item) {
  return {
    key: item.key,
    type: item.type,
    name: item.name,
    source: item.source,
    lastSeenAt: referenceEpochMs(item.lastSeenAt),
  };
}

/*
 * The rows a collection lists: live rows of the type (not deduplicated by
 * key — the server pages rows), narrowed by activity unless inactive items
 * are included, and by every name term (a case-insensitive substring; a row
 * without a name matches no term, as `NULL ILIKE ...` does not).
 */
function collectionRows(estate, request, entityType, nameTerms) {
  return estate.items.filter((item) => {
    if (
      item.projectId !== estate.projectId ||
      item.isArchived ||
      item.deleted ||
      item.type !== entityType
    ) {
      return false;
    }
    if (
      !request.includeInactive &&
      !isReferenceActive(item, request.rangeStart)
    ) {
      return false;
    }
    return nameTerms.every((term) => {
      return (
        typeof item.name === "string" && item.name.toLowerCase().includes(term)
      );
    });
  });
}

/* Keyset order: display name ("" when missing), then key. */
function compareCollectionRows(left, right) {
  return (
    compareCollateC(left.name || "", right.name || "") ||
    compareCollateC(left.key, right.key)
  );
}

function collectionPage(estate, request) {
  const rows = collectionRows(
    estate,
    request,
    request.entityType,
    request.nameTerms,
  ).sort(compareCollectionRows);
  const cursor = request.cursor;
  const after = cursor
    ? rows.filter((item) => {
        return (
          compareCollectionRows(item, { name: cursor.name, key: cursor.key }) >
          0
        );
      })
    : rows;
  const items = after.slice(0, request.limit);
  const last = items[items.length - 1];
  return {
    ...envelope(request.rangeStart),
    entityType: request.entityType,
    total: rows.length,
    items: items.map(leanEntity),
    nextCursor:
      after.length > request.limit && last
        ? { name: last.name || "", key: last.key }
        : null,
  };
}

function collectionSearch(estate, request) {
  const matches = [];
  for (const type of request.types) {
    const count = collectionRows(
      estate,
      request,
      type.entityType,
      type.nameTerms,
    ).length;
    if (count > 0) {
      matches.push({ entityType: type.entityType, count });
    }
  }
  return { ...envelope(request.rangeStart), matches };
}

function entityRequest(estate, request) {
  return {
    ...scope(estate, request),
    entityKey: request.entityKey,
    entityType: request.entityType,
  };
}

/*
 * "Show more": the section's rows from `offset`, with the next offset the
 * server would send (null once the rows reach the section's total).
 */
function entityConnections(estate, request) {
  const through = request.offset + request.limit;
  const detail = referenceEntity(estate, entityRequest(estate, request), {
    dependencyRows: through,
    otherRows: through,
  });
  const section = detail.sections[request.section];
  const rows = section.rows.slice(request.offset);
  const reached = request.offset + rows.length;
  return {
    ...envelope(request.rangeStart),
    section: request.section,
    connections: {
      total: section.total,
      unknownTotal: section.unknownTotal,
      rows,
      nextOffset: rows.length > 0 && reached < section.total ? reached : null,
    },
    isScanLimited: detail.isScanLimited,
  };
}

const ROUTES = new Map([
  [
    TopologyApiPath.ServiceMap,
    (estate, body) => {
      const request = TopologyRequest.parseMapRequest(body);
      return {
        ...referenceServiceMap(estate, scope(estate, request)),
        generatedAt: new Date().toISOString(),
      };
    },
  ],
  [
    TopologyApiPath.Infrastructure,
    (estate, body) => {
      const request = TopologyRequest.parseMapRequest(body);
      return {
        ...referenceInfrastructure(estate, scope(estate, request)),
        generatedAt: new Date().toISOString(),
      };
    },
  ],
  [
    TopologyApiPath.InfrastructureCollection,
    (estate, body) => {
      return collectionPage(
        estate,
        TopologyRequest.parseCollectionRequest(body),
      );
    },
  ],
  [
    TopologyApiPath.InfrastructureCollectionSearch,
    (estate, body) => {
      return collectionSearch(
        estate,
        TopologyRequest.parseCollectionSearchRequest(body),
      );
    },
  ],
  [
    TopologyApiPath.Entity,
    (estate, body) => {
      const request = TopologyRequest.parseEntityRequest(body);
      return {
        ...referenceEntity(estate, entityRequest(estate, request)),
        generatedAt: new Date().toISOString(),
      };
    },
  ],
  [
    TopologyApiPath.EntityConnections,
    (estate, body) => {
      return entityConnections(
        estate,
        TopologyRequest.parseEntityConnectionsRequest(body),
      );
    },
  ],
]);

/*
 * The Topology route a request URL names, or null. Matched on the end of the
 * path, so ".../infrastructure" never answers ".../infrastructure/collection".
 */
export function topologyRouteFor(url) {
  const pathname = new globalThis.URL(url, "http://localhost").pathname;
  for (const path of ROUTES.keys()) {
    if (pathname.endsWith(path)) {
      return path;
    }
  }
  return null;
}

export function isTopologyApiUrl(url) {
  return new globalThis.URL(url, "http://localhost").pathname.includes(
    "/telemetry/topology/",
  );
}

/*
 * Answers one request: `{ status: 200, body }`, or the status and
 * `{ message }` body the router's error handler sends (400 for a request the
 * server's parser refuses).
 */
export function answerTopologyRequest(estate, path, body) {
  const handler = ROUTES.get(path);
  if (!handler) {
    return { status: 404, body: { message: `No route for ${path}` } };
  }
  try {
    return { status: 200, body: handler(estate, body) };
  } catch (error) {
    if (error instanceof BadDataException) {
      return { status: 400, body: { message: error.message } };
    }
    return {
      status: 500,
      body: { message: error?.message || "Server Error" },
    };
  }
}
