import { AnalyzableSpan } from "../../../Utils/Traces/SpanTreeAnalyzer";

/*
 * Span trees as real traces look, for the "is this trace worth Fix
 * performance with AI?" tests: each fixture is a request a person could
 * open on the trace page, with the timings that decide the answer. Times
 * are milliseconds from the start of the trace.
 */

export interface TraceFixture {
  // What the trace is, as a test name reads it.
  title: string;
  spans: Array<AnalyzableSpan>;
}

function querySpans(data: {
  count: number;
  parent: string;
  startMs: number;
  eachMs: number;
  gapMs?: number;
  name?: string;
  statement?: (index: number) => string;
  idPrefix?: string;
}): Array<AnalyzableSpan> {
  const spans: Array<AnalyzableSpan> = [];
  let cursor: number = data.startMs;

  for (let index: number = 0; index < data.count; index++) {
    spans.push({
      spanId: `${data.idPrefix || "query"}-${index}`,
      parentSpanId: data.parent,
      name: data.name || "SELECT products WHERE id = $1",
      startMs: cursor,
      endMs: cursor + data.eachMs,
      attributes: {
        "db.system": "postgresql",
        "db.statement": data.statement
          ? data.statement(index)
          : `SELECT * FROM products WHERE id = ${1000 + index}`,
      },
    });
    cursor += data.eachMs + (data.gapMs || 0);
  }

  return spans;
}

/*
 * A checkout that loads its 14 products one query at a time: 840 ms of a
 * 1.6 s request. The textbook case the button is for.
 */
export const SLOW_CHECKOUT_WITH_N_PLUS_ONE: TraceFixture = {
  title: "a slow checkout that runs the same query 14 times",
  spans: [
    {
      spanId: "root",
      name: "POST /api/v1/checkout",
      startMs: 0,
      endMs: 1600,
    },
    ...querySpans({ count: 14, parent: "root", startMs: 100, eachMs: 60 }),
    {
      spanId: "render",
      parentSpanId: "root",
      name: "render receipt",
      startMs: 1000,
      endMs: 1500,
    },
  ],
};

/*
 * The same loop on a fast request: five 2 ms queries in a 15 ms request.
 * A pattern, but nothing a pull request would make anyone notice.
 */
export const FAST_REQUEST_WITH_N_PLUS_ONE: TraceFixture = {
  title: "a fast request with five 2 ms queries in a loop",
  spans: [
    { spanId: "root", name: "GET /api/v1/cart", startMs: 0, endMs: 15 },
    ...querySpans({ count: 5, parent: "root", startMs: 2, eachMs: 2 }),
  ],
};

// A single-span health check: its one span is all of it, and it is 3 ms.
export const HEALTH_CHECK: TraceFixture = {
  title: "a 3 ms health check of one span",
  spans: [{ spanId: "root", name: "GET /healthz", startMs: 0, endMs: 3 }],
};

/*
 * A healthy, fast page: a handful of different calls, none of which
 * repeats or dominates.
 */
export const FAST_CLEAN_REQUEST: TraceFixture = {
  title: "a fast request with nothing repeated or dominant",
  spans: [
    { spanId: "root", name: "GET /api/v1/home", startMs: 0, endMs: 120 },
    {
      spanId: "auth",
      parentSpanId: "root",
      name: "verify session",
      startMs: 0,
      endMs: 40,
    },
    {
      spanId: "feed",
      parentSpanId: "root",
      name: "SELECT feed",
      startMs: 40,
      endMs: 80,
      attributes: {
        "db.system": "postgresql",
        "db.statement": "SELECT * FROM feed WHERE user_id = 7",
      },
    },
    {
      spanId: "render",
      parentSpanId: "root",
      name: "render home",
      startMs: 80,
      endMs: 120,
    },
  ],
};

/*
 * Slow, with no known pattern: three seconds spread over different calls,
 * none of them repeated and none taking most of the request. The analysis
 * has nothing grounded to hand the AI.
 */
export const SLOW_REQUEST_WITHOUT_A_PATTERN: TraceFixture = {
  title: "a slow request whose time is spread over different calls",
  spans: [
    { spanId: "root", name: "POST /api/v1/report", startMs: 0, endMs: 3000 },
    {
      spanId: "load",
      parentSpanId: "root",
      name: "load report rows",
      startMs: 0,
      endMs: 1000,
    },
    {
      spanId: "aggregate",
      parentSpanId: "root",
      name: "aggregate totals",
      startMs: 1000,
      endMs: 2000,
    },
    {
      spanId: "export",
      parentSpanId: "root",
      name: "write csv",
      startMs: 2000,
      endMs: 3000,
    },
  ],
};

/*
 * Four calls to the inventory service made one after another, 150 ms
 * each, inside an 800 ms parent: 600 ms that could have been 150.
 */
export const SLOW_CALLS_ONE_AFTER_ANOTHER: TraceFixture = {
  title: "four 150 ms inventory calls made one after another",
  spans: [
    { spanId: "root", name: "POST /api/v1/order", startMs: 0, endMs: 900 },
    {
      spanId: "reserve",
      parentSpanId: "root",
      name: "reserve stock",
      startMs: 50,
      endMs: 850,
    },
    ...[0, 1, 2, 3].map((index: number): AnalyzableSpan => {
      return {
        spanId: `inventory-${index}`,
        parentSpanId: "reserve",
        name: `GET /inventory/${41 + index}`,
        startMs: 100 + index * 160,
        endMs: 250 + index * 160,
        attributes: {
          "http.url": `https://inventory.internal/inventory/${41 + index}`,
        },
      };
    }),
  ],
};

/*
 * One report query takes 2.1 s of a 2.4 s request on its own: one slow
 * call worth a look.
 */
export const SLOW_SINGLE_QUERY: TraceFixture = {
  title: "one 2.1 s query in a 2.4 s request",
  spans: [
    { spanId: "root", name: "GET /api/v1/invoices", startMs: 0, endMs: 2400 },
    {
      spanId: "query",
      parentSpanId: "root",
      name: "SELECT invoices",
      startMs: 200,
      endMs: 2300,
      attributes: {
        "db.system": "postgresql",
        "db.statement":
          "SELECT * FROM invoices WHERE account_id = 42 ORDER BY created_at",
      },
    },
  ],
};

/*
 * A 300 ms call to a payment provider in a 350 ms request: most of the
 * request, but an ordinary time for such a call - not worth a pull request.
 */
export const ORDINARY_EXTERNAL_CALL: TraceFixture = {
  title: "a 300 ms payment call in a 350 ms request",
  spans: [
    { spanId: "root", name: "POST /api/v1/pay", startMs: 0, endMs: 350 },
    {
      spanId: "stripe",
      parentSpanId: "root",
      name: "POST https://api.stripe.com/v1/charges",
      startMs: 25,
      endMs: 325,
      attributes: { "http.url": "https://api.stripe.com/v1/charges" },
    },
  ],
};

/*
 * A 30 s nightly batch whose 50 small lookups add up to 150 ms: a real
 * N+1, but half a percent of the run. Its three steps share the rest, none
 * of them most of it.
 */
export const LONG_BATCH_WITH_A_SMALL_N_PLUS_ONE: TraceFixture = {
  title: "a 30 s batch whose 50 lookups take 150 ms",
  spans: [
    { spanId: "root", name: "nightly export", startMs: 0, endMs: 30000 },
    {
      spanId: "extract",
      parentSpanId: "root",
      name: "extract rows",
      startMs: 200,
      endMs: 10000,
    },
    {
      spanId: "transform",
      parentSpanId: "root",
      name: "transform rows",
      startMs: 10000,
      endMs: 20000,
    },
    {
      spanId: "load",
      parentSpanId: "root",
      name: "write archive",
      startMs: 20000,
      endMs: 29800,
    },
    ...querySpans({
      count: 50,
      parent: "root",
      startMs: 29800,
      eachMs: 3,
      name: "SELECT setting",
      statement: (index: number): string => {
        return `SELECT value FROM settings WHERE key = 'k${index}'`;
      },
      idPrefix: "setting",
    }),
  ],
};

// A single span that is slow all by itself: 2.4 s of work, no children.
export const SLOW_SINGLE_SPAN: TraceFixture = {
  title: "a 2.4 s request of one span",
  spans: [
    { spanId: "root", name: "POST /api/v1/import", startMs: 0, endMs: 2400 },
  ],
};

export const WORTH_FIXING_TRACES: Array<TraceFixture> = [
  SLOW_CHECKOUT_WITH_N_PLUS_ONE,
  SLOW_CALLS_ONE_AFTER_ANOTHER,
  SLOW_SINGLE_QUERY,
  SLOW_SINGLE_SPAN,
];

export const NOT_WORTH_FIXING_TRACES: Array<TraceFixture> = [
  FAST_REQUEST_WITH_N_PLUS_ONE,
  HEALTH_CHECK,
  FAST_CLEAN_REQUEST,
  SLOW_REQUEST_WITHOUT_A_PATTERN,
  ORDINARY_EXTERNAL_CALL,
  LONG_BATCH_WITH_A_SMALL_N_PLUS_ONE,
];
