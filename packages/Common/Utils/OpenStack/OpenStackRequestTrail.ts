import { JSONObject } from "../../Types/JSON";
import { getOpenStackShortHostName } from "../../Types/OpenStack/OpenStackHealthRules";
import {
  OPENSTACK_CLOUD_LOG_ATTRIBUTE,
  OpenStackLogAttribute,
} from "./OpenStackLogs";

interface RequestTally {
  services: Set<string>;
  lineCount: number;
  failed: boolean;
  first: number;
  last: number;
}

interface ServiceTally {
  hosts: Set<string>;
  lineCount: number;
  failed: boolean;
  first: number;
}

/*
 * FOLLOWING ONE REQUEST ACROSS SERVICES, AND SAYING HOW FAR THAT GOT.
 *
 * Every line of one request holds one value in openstack.request_root_id: its global ID
 * where it has one, else its own request ID (OpenStackLogs). Nova hands its request ID on
 * as the global ID when it calls Neutron, Cinder or Glance, so those join. But a caller
 * has to send one for that to work, and a service that was not called with one writes a
 * request ID nobody else knows. Nothing in a line says it belongs to a request it does not
 * name, so the honest answer is two lists: the services whose lines hold this request, and
 * the ones that wrote other requests' lines in the same moments, which OneUptime cannot
 * tell whether they took part in.
 *
 * Pure: the page reads the rows and this says what they mean. A log's attributes are what
 * anyone could have sent, and are treated as text.
 */

export const OPENSTACK_REQUEST_QUERY_PARAM: string = "request";
export const OPENSTACK_REQUEST_TIME_QUERY_PARAM: string = "at";

// A row of the Log table, as far as this reads one.
export interface OpenStackTrailRow {
  time: Date | string | null | undefined;
  severityText?: string | null | undefined;
  attributes?: JSONObject | null | undefined;
}

function readAttribute(row: OpenStackTrailRow, key: string): string {
  const value: unknown = row.attributes ? row.attributes[key] : undefined;

  return typeof value === "string" ? value : "";
}

function readTime(row: OpenStackTrailRow): number {
  if (!row.time) {
    return 0;
  }

  const time: number = new Date(row.time).getTime();

  return Number.isNaN(time) ? 0 : time;
}

function isFailureSeverity(severity: string | null | undefined): boolean {
  return severity === "Error" || severity === "Fatal";
}

export interface OpenStackRequestSummary {
  // What the Logs page is opened on.
  rootId: string;
  services: Array<string>;
  lineCount: number;
  failed: boolean;
  firstAt: Date | null;
  lastAt: Date | null;
}

/*
 * The requests a part's lines belong to, the ones that failed first and then the newest:
 * the first thing anyone wants off an instance that will not build.
 */
export function summarizeOpenStackRequests(
  rows: ReadonlyArray<OpenStackTrailRow>,
): Array<OpenStackRequestSummary> {
  const byRoot: Map<string, RequestTally> = new Map();

  for (const row of rows) {
    const rootId: string = readAttribute(
      row,
      OpenStackLogAttribute.RequestRootId,
    );

    if (!rootId) {
      continue;
    }

    const time: number = readTime(row);
    const known: {
      services: Set<string>;
      lineCount: number;
      failed: boolean;
      first: number;
      last: number;
    } = byRoot.get(rootId) || {
      services: new Set<string>(),
      lineCount: 0,
      failed: false,
      first: time,
      last: time,
    };
    const service: string = readAttribute(row, OpenStackLogAttribute.Service);

    if (service) {
      known.services.add(service);
    }

    known.lineCount += 1;
    known.failed = known.failed || isFailureSeverity(row.severityText);
    known.first = Math.min(known.first, time);
    known.last = Math.max(known.last, time);
    byRoot.set(rootId, known);
  }

  return Array.from(byRoot.entries())
    .map(([rootId, known]: [string, RequestTally]): OpenStackRequestSummary => {
      return {
        rootId,
        services: Array.from(known.services).sort(),
        lineCount: known.lineCount,
        failed: known.failed,
        firstAt: known.first ? new Date(known.first) : null,
        lastAt: known.last ? new Date(known.last) : null,
      };
    })
    .sort((a: OpenStackRequestSummary, b: OpenStackRequestSummary): number => {
      if (a.failed !== b.failed) {
        return a.failed ? -1 : 1;
      }

      return (b.lastAt?.getTime() || 0) - (a.lastAt?.getTime() || 0);
    });
}

export interface OpenStackRequestJoinedService {
  service: string;
  hosts: Array<string>;
  lineCount: number;
  failed: boolean;
  firstAt: Date | null;
}

export interface OpenStackRequestJoin {
  // In the order they first wrote about it.
  joined: Array<OpenStackRequestJoinedService>;
  /*
   * Services that wrote about a request in the same moments, and never about this one:
   * they may have taken part under a request ID of their own.
   */
  notJoined: Array<string>;
  firstAt: Date | null;
  lastAt: Date | null;
}

/*
 * What a request's own lines say, against what the cloud's services wrote in its window:
 * `requestRows` are the lines holding its root ID, and `windowRows` what the cloud wrote
 * around them. Only lines written for some request count against a service: a periodic
 * task's line says nothing about whether it was called.
 */
export function joinOpenStackRequest(data: {
  requestRows: ReadonlyArray<OpenStackTrailRow>;
  windowRows: ReadonlyArray<OpenStackTrailRow>;
}): OpenStackRequestJoin {
  const byService: Map<string, ServiceTally> = new Map();
  let first: number = 0;
  let last: number = 0;

  for (const row of data.requestRows) {
    const time: number = readTime(row);
    const service: string =
      readAttribute(row, OpenStackLogAttribute.Service) || "unknown";
    const host: string = readAttribute(row, OpenStackLogAttribute.Host);
    const known: {
      hosts: Set<string>;
      lineCount: number;
      failed: boolean;
      first: number;
    } = byService.get(service) || {
      hosts: new Set<string>(),
      lineCount: 0,
      failed: false,
      first: time,
    };

    if (host) {
      known.hosts.add(getOpenStackShortHostName(host));
    }

    known.lineCount += 1;
    known.failed = known.failed || isFailureSeverity(row.severityText);
    known.first = Math.min(known.first, time);
    byService.set(service, known);
    first = first === 0 ? time : Math.min(first, time);
    last = Math.max(last, time);
  }

  const joined: Array<OpenStackRequestJoinedService> = Array.from(
    byService.entries(),
  )
    .map(([service, known]: [string, ServiceTally]): OpenStackRequestJoinedService => {
      return {
        service,
        hosts: Array.from(known.hosts).sort(),
        lineCount: known.lineCount,
        failed: known.failed,
        firstAt: known.first ? new Date(known.first) : null,
      };
    })
    .sort(
      (
        a: OpenStackRequestJoinedService,
        b: OpenStackRequestJoinedService,
      ): number => {
        return (a.firstAt?.getTime() || 0) - (b.firstAt?.getTime() || 0);
      },
    );

  const notJoined: Set<string> = new Set<string>();

  for (const row of data.windowRows) {
    const service: string = readAttribute(row, OpenStackLogAttribute.Service);

    if (
      service &&
      !byService.has(service) &&
      readAttribute(row, OpenStackLogAttribute.RequestRootId)
    ) {
      notJoined.add(service);
    }
  }

  return {
    joined,
    notJoined: Array.from(notJoined).sort(),
    firstAt: first ? new Date(first) : null,
    lastAt: last ? new Date(last) : null,
  };
}

// The request a stored line belongs to, and when, for its Follow link.
export function readOpenStackLineRequest(attributes: unknown): {
  rootId: string;
  cloudName: string;
} | null {
  if (!attributes || typeof attributes !== "object") {
    return null;
  }

  const record: Record<string, unknown> = attributes as Record<string, unknown>;
  const rootId: unknown = record[OpenStackLogAttribute.RequestRootId];
  const cloudName: unknown = record[OPENSTACK_CLOUD_LOG_ATTRIBUTE];

  return typeof rootId === "string" &&
    rootId &&
    typeof cloudName === "string" &&
    cloudName
    ? { rootId, cloudName }
    : null;
}
