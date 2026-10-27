import type { SpanKind } from "../../Models/AnalyticsModels/Span";

/*
 * Entry spans: the spans where work enters a service.
 *
 * A span is one when it starts its trace (a root span), or when it is the
 * receiving end of a request or a message, whatever its parent: OpenTelemetry's
 * SERVER kind (an HTTP or RPC request the service handled) and CONSUMER kind (a
 * message it took off a queue). A service behind a gateway or a queue never
 * owns the root of a trace, so "root spans" alone hides every request it
 * served; its SERVER and CONSUMER spans are where its work starts.
 *
 * Not entry spans, unless they start their trace: a CLIENT call out (a
 * database query, a Redis command, an HTTP call to another service), a
 * PRODUCER send, and INTERNAL steps (eBPF's "in queue" / "processing").
 *
 * This is the one definition the stored column (Span.isEntrySpan), the ingest
 * that writes it and the DEFAULT expression the rows stored before the column
 * existed are read with all share, so the three cannot disagree. No runtime
 * import: the Span model reads the DEFAULT expression from here, and the
 * dashboard and the ingest load this without the model.
 */

/*
 * The kinds that make a span an entry span whatever its parent. Typed by the
 * SpanKind enum's values, so a kind that is not one fails to compile.
 */
export const ENTRY_SPAN_KINDS: ReadonlyArray<`${SpanKind}`> = [
  "SPAN_KIND_SERVER",
  "SPAN_KIND_CONSUMER",
];

export interface EntrySpanFields {
  isRootSpan: boolean;
  // The stored kind ("SPAN_KIND_SERVER"); anything else is not an entry kind.
  kind?: unknown;
}

export function isEntrySpan(span: EntrySpanFields): boolean {
  if (span.isRootSpan === true) {
    return true;
  }

  return (
    typeof span.kind === "string" &&
    (ENTRY_SPAN_KINDS as ReadonlyArray<string>).includes(span.kind)
  );
}

/*
 * The same rule in ClickHouse, as the DEFAULT expression of the isEntrySpan
 * column: what a row that does not carry the column reads. Every row stored
 * before the column was added is one - ADD COLUMN rewrites no part, and
 * ClickHouse computes the expression from the row's isRootSpan and kind when
 * it reads a part that has no isEntrySpan file - so the old rows filter
 * correctly with no backfill.
 *
 * `kind` is Nullable: `NULL IN (...)` is NULL, and NULL OR false is NULL,
 * which a Bool column cannot hold, so a missing kind is read as ''.
 */
export const IS_ENTRY_SPAN_DEFAULT_EXPRESSION: string = `isRootSpan OR (ifNull(kind, '') IN (${ENTRY_SPAN_KINDS.map(
  (kind: string): string => {
    return `'${kind}'`;
  },
).join(", ")}))`;
