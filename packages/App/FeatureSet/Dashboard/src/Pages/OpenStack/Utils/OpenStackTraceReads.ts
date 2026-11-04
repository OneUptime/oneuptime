import Span from "Common/Models/AnalyticsModels/Span";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import Service from "Common/Models/DatabaseModels/Service";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  OPENSTACK_CLOUD_SPAN_ATTRIBUTE,
  OpenStackTracedServices,
  OpenStackTraceRow,
  getOpenStackTracedServiceOfApi,
  readOpenStackTracedServices,
} from "Common/Utils/OpenStack/OpenStackTraces";
import { keyForOpenStackCloud } from "Common/Utils/Telemetry/EntityKey";
import { isOpenStackNetworkAgent } from "./OpenStackPartFacts";

/*
 * What a cloud's Traces page reads. Every read is bounded: a page of a cloud's newest spans,
 * the spans of a handful of traces, and the few rows that name a command's flavor, image and
 * network. A trace is on demand, so a cloud may have none for weeks, and the look back is
 * long for that reason: the spans it reads are indexed by the cloud's key.
 */

// As far back as a page looks for a cloud's traces. Tracing is on demand.
const LOOK_BACK_IN_DAYS: number = 30;
// Enough to say which services a cloud's traces cross and which traces are newest.
const RECENT_SPANS_READ: number = 500;
// How many of the newest traces a control plane map is drawn from.
const TRACES_MAPPED: number = 10;
const SPANS_MAPPED: number = 5000;
const COMMAND_ROWS_READ: number = 200;
const SERVICE_ROWS_READ: number = 500;

function getCloudSpanScope(cloudName: string): JSONObject {
  return {
    entityKeys: [
      keyForOpenStackCloud(
        ProjectUtil.getCurrentProjectId()!.toString(),
        cloudName,
      ),
    ],
    attributeKey: OPENSTACK_CLOUD_SPAN_ATTRIBUTE,
    attributeValue: cloudName,
  };
}

export async function fetchOpenStackTracedServices(
  cloudName: string,
): Promise<OpenStackTracedServices> {
  const now: Date = OneUptimeDate.getCurrentDate();
  const result: ListResult<Span> = await AnalyticsModelAPI.getList<Span>({
    modelType: Span,
    // `entityScope` is a query key of its own, which Query<Span> does not know.
    query: {
      startTime: new InBetween<Date>(
        OneUptimeDate.addRemoveDays(now, -LOOK_BACK_IN_DAYS),
        now,
      ),
      isEntrySpan: true,
      entityScope: getCloudSpanScope(cloudName),
    } as unknown as Query<Span>,
    select: { startTime: true, traceId: true, attributes: true },
    sort: { startTime: SortOrder.Descending },
    limit: RECENT_SPANS_READ,
    skip: 0,
  });

  return readOpenStackTracedServices(
    result.data.map((row: Span): OpenStackTraceRow => {
      return {
        startTime: row.startTime,
        traceId: row.traceId,
        attributes: (row.attributes as JSONObject | undefined) || null,
      };
    }),
  );
}

export interface OpenStackControlPlaneSpans {
  spans: Array<Span>;
  services: Array<Service>;
}

/*
 * The spans a map of the control plane is drawn from: those of the newest few traces, whole,
 * because a call is only known by its two ends being in the same read.
 */
export async function fetchOpenStackControlPlaneSpans(
  traceIds: ReadonlyArray<string>,
): Promise<OpenStackControlPlaneSpans> {
  const ids: Array<string> = traceIds.slice(0, TRACES_MAPPED);

  if (ids.length === 0) {
    return { spans: [], services: [] };
  }

  const [spans, services]: [ListResult<Span>, ListResult<Service>] =
    await Promise.all([
      AnalyticsModelAPI.getList<Span>({
        modelType: Span,
        query: { traceId: new Includes(ids) } as unknown as Query<Span>,
        select: {
          name: true,
          traceId: true,
          spanId: true,
          parentSpanId: true,
          primaryEntityId: true,
          durationUnixNano: true,
          startTimeUnixNano: true,
          endTimeUnixNano: true,
          statusCode: true,
        },
        sort: { startTime: SortOrder.Descending },
        limit: SPANS_MAPPED,
        skip: 0,
      }),
      ModelAPI.getList<Service>({
        modelType: Service,
        query: { projectId: ProjectUtil.getCurrentProjectId()! },
        select: { _id: true, name: true, serviceColor: true },
        sort: { name: SortOrder.Ascending },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      }),
    ]);

  return { spans: spans.data, services: services.data };
}

/*
 * The services this cloud runs that a trace could cross, by the word a trace knows each by.
 * A Neutron agent is left out: it answers no API, and no request is signed through it.
 */
export async function fetchOpenStackServicesThatCanBeTraced(
  openStackCloudId: ObjectID,
): Promise<Array<string>> {
  const result: ListResult<OpenStackResource> =
    await ModelAPI.getList<OpenStackResource>({
      modelType: OpenStackResource,
      query: {
        openStackCloudId: openStackCloudId,
        kind: new Includes([
          OpenStackResourceKind.Api,
          OpenStackResourceKind.Service,
        ]),
      } as Query<OpenStackResource>,
      select: { kind: true, name: true, externalId: true, facts: true },
      sort: { name: SortOrder.Ascending },
      limit: SERVICE_ROWS_READ,
      skip: 0,
    });

  const names: Set<string> = new Set<string>();

  for (const row of result.data) {
    if (row.kind === OpenStackResourceKind.Api) {
      const traced: string = getOpenStackTracedServiceOfApi(row.name || "");

      if (traced) {
        names.add(traced);
      }
    } else if (row.name && !isOpenStackNetworkAgent(row)) {
      names.add(row.name);
    }
  }

  return Array.from(names).sort();
}

export interface OpenStackTraceCommandRows {
  flavors: Array<OpenStackResource>;
  images: Array<OpenStackResource>;
  networks: Array<OpenStackResource>;
}

async function fetchRowsOf(data: {
  openStackCloudId: ObjectID;
  kind: OpenStackResourceKind;
  region: string | null;
}): Promise<Array<OpenStackResource>> {
  const result: ListResult<OpenStackResource> =
    await ModelAPI.getList<OpenStackResource>({
      modelType: OpenStackResource,
      query: {
        openStackCloudId: data.openStackCloudId,
        kind: data.kind,
        ...(data.region ? { regionName: data.region } : {}),
      } as Query<OpenStackResource>,
      select: {
        externalId: true,
        name: true,
        status: true,
        vcpuCapacity: true,
        memoryCapacityBytes: true,
        diskCapacityBytes: true,
        facts: true,
      },
      sort: { name: SortOrder.Ascending },
      limit: COMMAND_ROWS_READ,
      skip: 0,
    });

  return result.data;
}

export async function fetchOpenStackTraceCommandRows(data: {
  openStackCloudId: ObjectID;
  region: string | null;
}): Promise<OpenStackTraceCommandRows> {
  const [flavors, images, networks]: [
    Array<OpenStackResource>,
    Array<OpenStackResource>,
    Array<OpenStackResource>,
  ] = await Promise.all([
    fetchRowsOf({ ...data, kind: OpenStackResourceKind.Flavor }),
    fetchRowsOf({ ...data, kind: OpenStackResourceKind.Image }),
    fetchRowsOf({ ...data, kind: OpenStackResourceKind.Network }),
  ]);

  return { flavors, images, networks };
}
