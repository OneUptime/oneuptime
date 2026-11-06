import Log from "Common/Models/AnalyticsModels/Log";
import Span from "Common/Models/AnalyticsModels/Span";
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { getOpenStackShortHostName } from "Common/Types/OpenStack/OpenStackHealthRules";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import AnalyticsModelAPI, {
  ListResult as AnalyticsListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { OPENSTACK_CLOUD_LOG_ATTRIBUTE } from "Common/Utils/OpenStack/OpenStackLogs";
import {
  OpenStackTraceRequest,
  OpenStackTraceSpanForLogs,
  joinOpenStackTraceToRequests,
} from "Common/Utils/OpenStack/OpenStackTraceLogs";
import {
  OPENSTACK_CLOUD_SPAN_ATTRIBUTE,
  OPENSTACK_NODE_SPAN_ATTRIBUTE,
  OPENSTACK_TRACE_SCOPE_NAMES,
  OSPROFILER_SCOPE_SPAN_ATTRIBUTE,
  OpenStackTraceSource,
  getOpenStackTraceSource,
  isOpenStackTraceCarriedOverHttp,
  OpenStackTraceAttribute,
  OpenStackTraceResource,
  getOpenStackApiOfTracedService,
  getOpenStackServicesLeftOutOfTraces,
  hasOpenStackSpanMissingItsParent,
  readOpenStackSpanResources,
} from "Common/Utils/OpenStack/OpenStackTraces";

/*
 * What a trace is about, for the card above it: the cloud, the services it crossed and the
 * parts it touched, each to its own page, and the requests in the logs that go with it. Read
 * from the trace's spans, so nothing is read for a trace that is not OpenStack's but a look
 * for one of its spans.
 */

const SPANS_READ: number = 2000;
const ROWS_READ: number = 200;
const LOG_ROWS_READ: number = 1000;
// How far past a trace's end its lines are looked for: a service logs a call as it ends.
const LOG_WINDOW_MARGIN_IN_SECONDS: number = 5;

// One service a trace crossed, and the row that is its page if the inventory has one.
export interface OpenStackTraceService {
  service: string;
  host: string;
  row: OpenStackResource | null;
}

export interface OpenStackTracePart {
  resource: OpenStackTraceResource;
  // Null when the inventory holds no such part, which a deleted instance does not.
  row: OpenStackResource | null;
}

export interface OpenStackTraceContext {
  cloud: OpenStackCloud | null;
  cloudName: string;
  services: Array<OpenStackTraceService>;
  parts: Array<OpenStackTracePart>;
  requests: Array<OpenStackTraceRequest>;
  /*
   * What a stock cloud leaves out of a trace, when this one has a span under something that
   * sent nothing, which the waterfall below reports as a missing parent. Empty otherwise.
   */
  leftOut: Array<string>;
  // Who sent this trace, and for oslo's, whether it went on across an HTTP call.
  sources: Array<OpenStackTraceSource>;
  carriedOverHttp: boolean;
}

function readText(attributes: JSONObject, key: string): string {
  const value: unknown = attributes[key];

  return typeof value === "string" ? value : "";
}

/*
 * The service row that is this span's: an API by its type and the region's, and a worker by
 * its binary and host. A worker's external id holds the host (OpenStackSnapshotScan), which
 * Nova and a machine may write long or short, so hosts are compared by their short name.
 */
export function findOpenStackServiceRow(data: {
  service: string;
  host: string;
  rows: ReadonlyArray<OpenStackResource>;
}): OpenStackResource | null {
  const apiType: string | null = getOpenStackApiOfTracedService(data.service);

  if (apiType) {
    return (
      data.rows.find((row: OpenStackResource): boolean => {
        return row.kind === OpenStackResourceKind.Api && row.name === apiType;
      }) || null
    );
  }

  const candidates: Array<OpenStackResource> = data.rows.filter(
    (row: OpenStackResource): boolean => {
      return (
        row.kind === OpenStackResourceKind.Service && row.name === data.service
      );
    },
  );
  const host: string = getOpenStackShortHostName(data.host);

  return (
    candidates.find((row: OpenStackResource): boolean => {
      return (
        Boolean(host) &&
        (row.externalId || "").split("/").some((word: string): boolean => {
          return getOpenStackShortHostName(word) === host;
        })
      );
    }) ||
    candidates[0] ||
    null
  );
}

// What a trace's spans are about, from what a row's attributes say.
export function readOpenStackTraceSpans(spans: ReadonlyArray<Span>): {
  cloudName: string;
  services: Array<{ service: string; host: string }>;
  resources: Array<OpenStackTraceResource>;
  forLogs: Array<OpenStackTraceSpanForLogs>;
  leftOut: Array<string>;
  sources: Array<OpenStackTraceSource>;
  carriedOverHttp: boolean;
} {
  let cloudName: string = "";
  const services: Map<string, { service: string; host: string }> = new Map();
  const resources: Map<string, OpenStackTraceResource> = new Map();
  const forLogs: Array<OpenStackTraceSpanForLogs> = [];
  const sources: Set<OpenStackTraceSource> = new Set<OpenStackTraceSource>();
  let carriedOverHttp: boolean = false;

  for (const span of spans) {
    const attributes: JSONObject = (span.attributes as JSONObject) || {};
    const source: OpenStackTraceSource | null =
      getOpenStackTraceSource(attributes);

    if (source) {
      sources.add(source);
    }

    carriedOverHttp =
      carriedOverHttp ||
      isOpenStackTraceCarriedOverHttp({
        parentSpanId: span.parentSpanId?.toString(),
        attributes: attributes,
      });

    cloudName =
      cloudName || readText(attributes, OPENSTACK_CLOUD_SPAN_ATTRIBUTE);

    const service: string = readText(
      attributes,
      OpenStackTraceAttribute.Service,
    );
    const host: string = readText(attributes, OPENSTACK_NODE_SPAN_ATTRIBUTE);

    if (service) {
      services.set(`${service}/${host}`, { service, host });
    }

    for (const resource of readOpenStackSpanResources(attributes)) {
      resources.set(`${resource.kind}/${resource.id}`, resource);
    }

    forLogs.push({
      service: service,
      method: readText(attributes, "http.method"),
      path: readText(attributes, "http.path"),
      startAt: span.startTime ? new Date(span.startTime) : null,
      endAt: span.endTime ? new Date(span.endTime) : null,
      attributes: attributes,
    });
  }

  return {
    cloudName,
    services: Array.from(services.values()).sort(
      (
        a: { service: string; host: string },
        b: { service: string; host: string },
      ): number => {
        return (
          a.service.localeCompare(b.service) || a.host.localeCompare(b.host)
        );
      },
    ),
    resources: Array.from(resources.values()),
    forLogs,
    leftOut: hasOpenStackSpanMissingItsParent(
      spans.map((span: Span) => {
        return {
          spanId: span.spanId?.toString(),
          parentSpanId: span.parentSpanId?.toString(),
        };
      }),
    )
      ? getOpenStackServicesLeftOutOfTraces(
          Array.from(services.values()).map(
            (service: { service: string }): string => {
              return service.service;
            },
          ),
        )
      : [],
    sources: Array.from(sources).sort(),
    carriedOverHttp: carriedOverHttp,
  };
}

async function fetchRequestsOfTrace(data: {
  cloudName: string;
  forLogs: Array<OpenStackTraceSpanForLogs>;
}): Promise<Array<OpenStackTraceRequest>> {
  const times: Array<number> = data.forLogs
    .flatMap((span: OpenStackTraceSpanForLogs): Array<Date | null> => {
      return [span.startAt, span.endAt];
    })
    .filter((time: Date | null): time is Date => {
      return Boolean(time) && !isNaN(time!.getTime());
    })
    .map((time: Date): number => {
      return time.getTime();
    });

  if (times.length === 0) {
    return [];
  }

  const result: AnalyticsListResult<Log> = await AnalyticsModelAPI.getList<Log>(
    {
      modelType: Log,
      query: {
        attributes: { [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: data.cloudName },
        time: new InBetween<Date>(
          new Date(Math.min(...times)),
          OneUptimeDate.addRemoveSeconds(
            new Date(Math.max(...times)),
            LOG_WINDOW_MARGIN_IN_SECONDS,
          ),
        ),
      } as unknown as Query<Log>,
      select: { time: true, severityText: true, attributes: true, body: true },
      sort: { time: SortOrder.Ascending },
      limit: LOG_ROWS_READ,
      skip: 0,
    },
  );

  return joinOpenStackTraceToRequests({
    spans: data.forLogs,
    logs: result.data.map((row: Log) => {
      return {
        time: row.time,
        severityText: row.severityText,
        body: row.body,
        attributes: (row.attributes as JSONObject | undefined) || null,
      };
    }),
  });
}

/*
 * Null when this trace is not OpenStack's. A read of the logs that fails costs that part
 * alone: the trace and its links still stand.
 */
export async function fetchOpenStackTraceContext(
  traceId: string,
): Promise<OpenStackTraceContext | null> {
  /*
   * One read for each scope, because an attribute is matched by one value: a look at anyone
   * else's trace costs an empty answer from each, and OSProfiler's and oslo's rarely share one.
   */
  const scopeRows: Array<AnalyticsListResult<Span>> = await Promise.all(
    OPENSTACK_TRACE_SCOPE_NAMES.map(
      (scopeName: string): Promise<AnalyticsListResult<Span>> => {
        return AnalyticsModelAPI.getList<Span>({
          modelType: Span,
          query: {
            traceId: traceId,
            attributes: {
              [OSPROFILER_SCOPE_SPAN_ATTRIBUTE]: scopeName,
            },
          } as unknown as Query<Span>,
          select: {
            spanId: true,
            parentSpanId: true,
            startTime: true,
            endTime: true,
            attributes: true,
          },
          sort: { startTime: SortOrder.Ascending },
          limit: SPANS_READ,
          skip: 0,
        });
      },
    ),
  );
  const openStackSpans: Array<Span> = scopeRows.flatMap(
    (rows: AnalyticsListResult<Span>): Array<Span> => {
      return rows.data;
    },
  );

  if (openStackSpans.length === 0) {
    return null;
  }

  const read: ReturnType<typeof readOpenStackTraceSpans> =
    readOpenStackTraceSpans(openStackSpans);

  if (!read.cloudName) {
    return {
      cloud: null,
      cloudName: "",
      services: read.services.map(
        (service: { service: string; host: string }): OpenStackTraceService => {
          return { ...service, row: null };
        },
      ),
      parts: read.resources.map(
        (resource: OpenStackTraceResource): OpenStackTracePart => {
          return { resource, row: null };
        },
      ),
      requests: [],
      leftOut: read.leftOut,
      sources: read.sources,
      carriedOverHttp: read.carriedOverHttp,
    };
  }

  const clouds: ListResult<OpenStackCloud> =
    await ModelAPI.getList<OpenStackCloud>({
      modelType: OpenStackCloud,
      query: { name: read.cloudName },
      select: { _id: true, name: true },
      sort: {},
      limit: 1,
      skip: 0,
    });
  const cloud: OpenStackCloud | null = clouds.data[0] || null;
  const cloudId: ObjectID | null = cloud?.id || null;

  const [partRows, serviceRows, requests]: [
    Array<OpenStackResource>,
    Array<OpenStackResource>,
    Array<OpenStackTraceRequest>,
  ] = await Promise.all([
    cloudId && read.resources.length > 0
      ? ModelAPI.getList<OpenStackResource>({
          modelType: OpenStackResource,
          query: {
            openStackCloudId: cloudId,
            externalId: new Includes(
              read.resources.map((resource: OpenStackTraceResource): string => {
                return resource.id;
              }),
            ),
          } as Query<OpenStackResource>,
          select: { kind: true, externalId: true, name: true, status: true },
          sort: {},
          limit: ROWS_READ,
          skip: 0,
        }).then((result: ListResult<OpenStackResource>) => {
          return result.data;
        })
      : Promise.resolve([]),
    cloudId
      ? ModelAPI.getList<OpenStackResource>({
          modelType: OpenStackResource,
          query: {
            openStackCloudId: cloudId,
            kind: new Includes([
              OpenStackResourceKind.Api,
              OpenStackResourceKind.Service,
            ]),
          } as Query<OpenStackResource>,
          select: { kind: true, externalId: true, name: true },
          sort: {},
          limit: ROWS_READ,
          skip: 0,
        }).then((result: ListResult<OpenStackResource>) => {
          return result.data;
        })
      : Promise.resolve([]),
    fetchRequestsOfTrace({
      cloudName: read.cloudName,
      forLogs: read.forLogs,
    }).catch(() => {
      return [];
    }),
  ]);

  return {
    cloud: cloud,
    cloudName: read.cloudName,
    services: read.services.map(
      (service: { service: string; host: string }): OpenStackTraceService => {
        return {
          ...service,
          row: findOpenStackServiceRow({ ...service, rows: serviceRows }),
        };
      },
    ),
    parts: read.resources.map(
      (resource: OpenStackTraceResource): OpenStackTracePart => {
        return {
          resource,
          row:
            partRows.find((row: OpenStackResource): boolean => {
              return (
                row.kind === resource.kind && row.externalId === resource.id
              );
            }) || null,
        };
      },
    ),
    requests: requests,
    leftOut: read.leftOut,
    sources: read.sources,
    carriedOverHttp: read.carriedOverHttp,
  };
}
