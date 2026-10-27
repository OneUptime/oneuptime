import type { SpanKind } from "Common/Models/AnalyticsModels/Span";
import { applyObiBullMqSpan } from "./ObiBullMqSpan";
import { applyObiClickHouseHttpSpan } from "./ObiClickHouseHttpSpan";
import { MutableSpanAttributeMap, isObiSpan } from "./ObiSpan";
import { removeObiSpanMetricsSkip } from "./ObiSpanMetricsSkip";

/*
 * The protocol semantics ingest gives OBI's spans where OBI records only the
 * transport: a ClickHouse statement sent over HTTP, recorded as a bare
 * `POST /` (ObiClickHouseHttpSpan), and a BullMQ queue operation, recorded
 * as a bare `evalsha` of a Lua script (ObiBullMqSpan). Both are OBI CLIENT
 * spans of different protocols, so at most one applies. OBI's own
 * span.metrics.skip note comes off every OBI span (ObiSpanMetricsSkip).
 *
 * The ingest service runs this once per span, before the evaluation row is
 * built: drop filters, scrub rules and pipelines see the stored name, kind
 * and attributes, the row's attribute keys are taken after it, and the
 * database and queue keys are read from its result. A span that is not
 * OBI's returns after one property read, untouched.
 */
export interface ObiStoredSpan {
  name: string;
  kind: SpanKind;
}

/**
 * The name and kind a span is stored with, its attributes rewritten in
 * place where one of OBI's protocols applies.
 */
export function applyObiSpanSemantics(data: {
  name: string;
  kind: SpanKind;
  attributes: MutableSpanAttributeMap;
}): ObiStoredSpan {
  if (!isObiSpan(data.attributes)) {
    return { name: data.name, kind: data.kind };
  }

  removeObiSpanMetricsSkip(data.attributes);

  const clickHouseName: string | null = applyObiClickHouseHttpSpan(data);
  if (clickHouseName !== null) {
    return { name: clickHouseName, kind: data.kind };
  }

  const bullMq: ObiStoredSpan | null = applyObiBullMqSpan(data);
  if (bullMq !== null) {
    return bullMq;
  }

  return { name: data.name, kind: data.kind };
}
