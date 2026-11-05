/*
 * What OSProfiler's driver really sent for a signed boot, as the rows OneUptime would hold for
 * it: what the agent's traces profile would have sent (Common/Tests/Fixtures/OpenStack/traces),
 * read through the real reader ingest runs, so a walk on a real trace fails when a page assumes
 * something the driver never writes.
 *
 * spanRowsFromRecording("flamingo-ovn/signed-boot", { cloudName, loadedAt, serviceIdOf }) returns
 * rows in the shape the ingest writes, moved up to the moment the page loaded, under this
 * fixture's cloud rather than the rig's.
 */
import TRACE_RECORDINGS from "openstack-trace-recordings";
import {
  normalizeOSProfilerResourceInPlace,
  readOSProfilerSpanInPlace,
} from "../../../Common/Utils/OpenStack/OpenStackTraces";

const KIND_NAMES = [
  "SPAN_KIND_UNSPECIFIED",
  "SPAN_KIND_INTERNAL",
  "SPAN_KIND_SERVER",
  "SPAN_KIND_CLIENT",
  "SPAN_KIND_PRODUCER",
  "SPAN_KIND_CONSUMER",
];
const SPAN_STATUS_UNSET = 0;
const SPAN_STATUS_ERROR = 2;

export function hasTraceRecording(name) {
  return Boolean(TRACE_RECORDINGS[name]);
}

function flatten(attributes, prefix) {
  const out = {};
  for (const attribute of attributes || []) {
    const value = attribute.value || {};
    for (const key of ["stringValue", "boolValue", "intValue", "doubleValue"]) {
      if (key in value) {
        out[`${prefix}${attribute.key}`] = value[key];
      }
    }
  }
  return out;
}

function setCloudName(block, cloudName) {
  for (const attribute of block.resource.attributes) {
    if (attribute.key === "openstack.cloud.name") {
      attribute.value = { stringValue: cloudName };
    }
  }
}

export function spanRowsFromRecording(name, options) {
  // A copy: the reader edits what it reads, and a page reads this more than once.
  const otlp = JSON.parse(JSON.stringify(TRACE_RECORDINGS[name].otlp));
  const spans = otlp.resourceSpans.flatMap((block) => {
    return block.scopeSpans.flatMap((scopeBlock) => {
      return scopeBlock.spans;
    });
  });
  const newest = spans.reduce((latest, span) => {
    const end = BigInt(span.endTimeUnixNano);
    return end > latest ? end : latest;
  }, 0n);
  const shift = BigInt(options.loadedAt) * 1000000n - newest;
  const rows = [];

  for (const block of otlp.resourceSpans) {
    setCloudName(block, options.cloudName);
    const service = normalizeOSProfilerResourceInPlace(block);
    const resource = flatten(block.resource.attributes, "resource.");
    const serviceName = resource["resource.service.name"];

    for (const scopeBlock of block.scopeSpans) {
      for (const span of scopeBlock.spans) {
        const attributes = {
          ...resource,
          ...flatten(span.attributes, ""),
          "scope.name": scopeBlock.scope.name,
        };
        const read = readOSProfilerSpanInPlace({
          name: span.name,
          kind: KIND_NAMES[span.kind] || KIND_NAMES[0],
          traceId: span.traceId,
          parentSpanId: span.parentSpanId || "",
          attributes: attributes,
          events: span.events,
          service: service,
        });

        if (read.saysNothing) {
          continue;
        }

        const start = BigInt(span.startTimeUnixNano) + shift;
        const end = BigInt(span.endTimeUnixNano) + shift;

        rows.push({
          _id: span.spanId,
          traceId: span.traceId,
          spanId: span.spanId,
          parentSpanId: read.parentSpanId,
          name: read.name,
          kind: read.kind,
          isRootSpan: !read.parentSpanId,
          isEntrySpan:
            !read.parentSpanId ||
            read.kind === "SPAN_KIND_SERVER" ||
            read.kind === "SPAN_KIND_CONSUMER",
          statusCode: read.isFailed ? SPAN_STATUS_ERROR : SPAN_STATUS_UNSET,
          statusMessage: read.statusMessage,
          startTime: new Date(Number(start / 1000000n)),
          endTime: new Date(Number(end / 1000000n)),
          startTimeUnixNano: start.toString(),
          endTimeUnixNano: end.toString(),
          durationUnixNano: (end - start).toString(),
          attributes: attributes,
          primaryEntityId: options.serviceIdOf(serviceName),
          entityKeys: [],
        });
      }
    }
  }

  return rows;
}

export function recordedInstanceOf(name) {
  return TRACE_RECORDINGS[name].instanceId;
}
