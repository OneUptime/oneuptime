import { JSONObject } from "../../Types/JSON";
import { OpenStackLogAttribute } from "./OpenStackLogs";

/*
 * FROM A TRACE TO THE LOGS OF ITS REQUESTS, AS FAR AS THAT CAN REALLY BE SAID.
 *
 * Nothing the driver sends holds a request ID, and no log line holds a trace's ID: OSProfiler
 * and oslo.log do not know each other. So a trace's requests are found by what the two have
 * in common, and how sure that is, is said with each:
 *
 *   names-instance   a line of the same moments that names an instance the trace touched.
 *                    A boot's lines name their instance all the way down, and only that
 *                    instance's request does, so this is as good as an ID.
 *   same-call        an API's own line for a call the trace made: the same service, method
 *                    and path, in the same moments. Sure, unless the same call was made
 *                    again at that moment by someone else.
 *   same-moment      a line of the trace's services in its moments, and nothing else. On a
 *                    quiet cloud that is the request, and on a busy one it may not be.
 *
 * Pure, so a test can hold it to a real boot: the instance's own request ID, as Nova's
 * instance actions say it, has to come out of what the services really logged. A log's
 * attributes are what anyone could have sent, and are treated as text.
 */

export enum OpenStackTraceRequestMatch {
  NamesInstance = "names-instance",
  SameCall = "same-call",
  SameMoment = "same-moment",
}

export interface OpenStackTraceSpanForLogs {
  service: string;
  method: string;
  path: string;
  startAt: Date | null;
  endAt: Date | null;
  attributes: JSONObject;
}

export interface OpenStackTraceLogRow {
  time?: Date | string | null | undefined;
  severityText?: string | null | undefined;
  body?: string | null | undefined;
  attributes?: JSONObject | null | undefined;
}

export interface OpenStackTraceRequest {
  rootId: string;
  match: OpenStackTraceRequestMatch;
  services: Array<string>;
  at: Date | null;
}

// How many a card says: past this it is a busy cloud, and the guess is no use.
const MAX_REQUESTS: number = 8;
const MAX_BODY_READ: number = 4096;

const MATCH_ORDER: ReadonlyArray<OpenStackTraceRequestMatch> = [
  OpenStackTraceRequestMatch.NamesInstance,
  OpenStackTraceRequestMatch.SameCall,
  OpenStackTraceRequestMatch.SameMoment,
];

function readText(row: OpenStackTraceLogRow, key: string): string {
  const value: unknown = row.attributes ? row.attributes[key] : undefined;

  return typeof value === "string" ? value : "";
}

function readTime(time: Date | string | null | undefined): number {
  if (!time) {
    return 0;
  }

  const at: number = new Date(time).getTime();

  return Number.isNaN(at) ? 0 : at;
}

/*
 * The calls an API's own lines can be held to: nova's request log writes
 * "POST /compute/v2.1/servers" status: 202, and the same is what every wsgi server writes.
 */
function readCalls(
  spans: ReadonlyArray<OpenStackTraceSpanForLogs>,
): Array<{ service: string; call: string; from: number; to: number }> {
  const calls: Array<{
    service: string;
    call: string;
    from: number;
    to: number;
  }> = [];

  for (const span of spans) {
    if (span.method && span.path && span.service) {
      calls.push({
        service: span.service,
        call: `${span.method} ${span.path}`,
        from: readTime(span.startAt),
        to: readTime(span.endAt),
      });
    }
  }

  return calls;
}

export function joinOpenStackTraceToRequests(data: {
  spans: ReadonlyArray<OpenStackTraceSpanForLogs>;
  logs: ReadonlyArray<OpenStackTraceLogRow>;
}): Array<OpenStackTraceRequest> {
  const instanceIds: Set<string> = new Set<string>();
  const services: Set<string> = new Set<string>();

  for (const span of data.spans) {
    const instance: unknown = span.attributes["openstack.instance_id"];

    if (typeof instance === "string" && instance) {
      instanceIds.add(instance);
    }

    if (span.service) {
      services.add(span.service);
    }
  }

  const calls: ReturnType<typeof readCalls> = readCalls(data.spans);
  const byRoot: Map<
    string,
    {
      match: OpenStackTraceRequestMatch;
      services: Set<string>;
      at: number;
    }
  > = new Map();

  for (const row of data.logs) {
    const rootId: string = readText(row, OpenStackLogAttribute.RequestRootId);

    if (!rootId) {
      continue;
    }

    const service: string = readText(row, OpenStackLogAttribute.Service);
    const instance: string = readText(row, OpenStackLogAttribute.InstanceId);
    const time: number = readTime(row.time);
    let match: OpenStackTraceRequestMatch | null = null;

    if (instance && instanceIds.has(instance)) {
      match = OpenStackTraceRequestMatch.NamesInstance;
    } else if (service && services.has(service)) {
      const body: string = (row.body || "").slice(0, MAX_BODY_READ);

      match = calls.some(
        (call: { service: string; call: string; from: number; to: number }) => {
          return (
            call.service === service &&
            body.includes(`"${call.call}`) &&
            (!time || !call.from || time >= call.from - 1000) &&
            (!time || !call.to || time <= call.to + 5000)
          );
        },
      )
        ? OpenStackTraceRequestMatch.SameCall
        : OpenStackTraceRequestMatch.SameMoment;
    }

    if (!match) {
      continue;
    }

    const known: { match: OpenStackTraceRequestMatch; services: Set<string>; at: number } =
      byRoot.get(rootId) || {
        match: match,
        services: new Set<string>(),
        at: time,
      };

    if (MATCH_ORDER.indexOf(match) < MATCH_ORDER.indexOf(known.match)) {
      known.match = match;
    }

    if (service) {
      known.services.add(service);
    }

    known.at = known.at && time ? Math.min(known.at, time) : known.at || time;
    byRoot.set(rootId, known);
  }

  return Array.from(byRoot.entries())
    .map(
      ([rootId, known]: [
        string,
        { match: OpenStackTraceRequestMatch; services: Set<string>; at: number },
      ]): OpenStackTraceRequest => {
        return {
          rootId: rootId,
          match: known.match,
          services: Array.from(known.services).sort(),
          at: known.at ? new Date(known.at) : null,
        };
      },
    )
    .sort((a: OpenStackTraceRequest, b: OpenStackTraceRequest): number => {
      return (
        MATCH_ORDER.indexOf(a.match) - MATCH_ORDER.indexOf(b.match) ||
        (a.at?.getTime() || 0) - (b.at?.getTime() || 0)
      );
    })
    .slice(0, MAX_REQUESTS);
}
