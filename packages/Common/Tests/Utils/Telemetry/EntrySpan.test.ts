import { describe, expect, test } from "@jest/globals";
import {
  ENTRY_SPAN_KINDS,
  EntrySpanFields,
  IS_ENTRY_SPAN_DEFAULT_EXPRESSION,
  isEntrySpan,
} from "../../../Utils/Telemetry/EntrySpan";

/*
 * Entry spans: where work enters a service - a root span, or a SERVER or
 * CONSUMER span whatever its parent. Ingest writes isEntrySpan with
 * isEntrySpan(), and the rows stored before the column existed read the
 * column's DEFAULT expression, so the two are pinned to the same rule here,
 * case by case: a row must filter the same whichever of the two decided it.
 */

const SERVER: string = "SPAN_KIND_SERVER";
const CONSUMER: string = "SPAN_KIND_CONSUMER";
const CLIENT: string = "SPAN_KIND_CLIENT";
const PRODUCER: string = "SPAN_KIND_PRODUCER";
const INTERNAL: string = "SPAN_KIND_INTERNAL";

interface EntrySpanCase {
  name: string;
  span: EntrySpanFields;
  isEntry: boolean;
}

/*
 * The spans of the OneUptime Kubernetes project that crowd the list, and
 * the ones people look for.
 */
const CASES: Array<EntrySpanCase> = [
  {
    name: "a root SERVER span: a request that started its trace",
    span: { isRootSpan: true, kind: SERVER },
    isEntry: true,
  },
  {
    name: "a SERVER span behind a gateway: a request into a downstream service",
    span: { isRootSpan: false, kind: SERVER },
    isEntry: true,
  },
  {
    name: "a CONSUMER span: a message a service took off a queue",
    span: { isRootSpan: false, kind: CONSUMER },
    isEntry: true,
  },
  {
    name: "a root INTERNAL span: a cron job or a CLI command",
    span: { isRootSpan: true, kind: INTERNAL },
    isEntry: true,
  },
  {
    name: "a root CLIENT span: an eBPF pgbouncer -> Postgres call with no parent",
    span: { isRootSpan: true, kind: CLIENT },
    isEntry: true,
  },
  {
    name: "a CLIENT span under a request: a Redis set or evalsha",
    span: { isRootSpan: false, kind: CLIENT },
    isEntry: false,
  },
  {
    name: "an INTERNAL sub-span: eBPF's 'in queue' or 'processing'",
    span: { isRootSpan: false, kind: INTERNAL },
    isEntry: false,
  },
  {
    name: "a PRODUCER span: a message sent, not received",
    span: { isRootSpan: false, kind: PRODUCER },
    isEntry: false,
  },
  {
    name: "a child span with no kind",
    span: { isRootSpan: false },
    isEntry: false,
  },
  {
    name: "a root span with no kind",
    span: { isRootSpan: true, kind: null },
    isEntry: true,
  },
  {
    name: "a kind written in another case is not an entry kind",
    span: { isRootSpan: false, kind: "server" },
    isEntry: false,
  },
  {
    name: "a kind that is not a string",
    span: { isRootSpan: false, kind: 2 },
    isEntry: false,
  },
];

/*
 * The DEFAULT expression, evaluated the way ClickHouse reads it for a row:
 * the expression is parsed into its parts here rather than trusted, so a
 * change to its shape fails this rather than silently disagreeing with
 * isEntrySpan().
 */
const EXPRESSION_SHAPE: RegExp =
  /^isRootSpan OR \(ifNull\(kind, ''\) IN \(((?:'[A-Z_]+'(?:, )?)+)\)\)$/;

type EvaluateDefaultFunction = (span: EntrySpanFields) => boolean;

const evaluateDefault: EvaluateDefaultFunction = (
  span: EntrySpanFields,
): boolean => {
  const match: RegExpMatchArray | null =
    IS_ENTRY_SPAN_DEFAULT_EXPRESSION.match(EXPRESSION_SHAPE);

  expect(match).not.toBeNull();

  const kinds: Array<string> = match![1]!.split(", ").map(
    (quoted: string): string => {
      return quoted.slice(1, -1);
    },
  );

  // ifNull(kind, ''): a missing kind reads as the empty string.
  const kind: unknown =
    span.kind === undefined || span.kind === null ? "" : span.kind;

  return span.isRootSpan || kinds.includes(String(kind));
};

describe("isEntrySpan", () => {
  test.each(CASES)("$name", (entry: EntrySpanCase) => {
    expect(isEntrySpan(entry.span)).toBe(entry.isEntry);
  });

  test("the entry kinds are SERVER and CONSUMER, nothing else", () => {
    expect([...ENTRY_SPAN_KINDS]).toEqual([SERVER, CONSUMER]);
  });

  test("every other OpenTelemetry kind needs to be the root", () => {
    for (const kind of [CLIENT, PRODUCER, INTERNAL]) {
      expect(isEntrySpan({ isRootSpan: false, kind })).toBe(false);
      expect(isEntrySpan({ isRootSpan: true, kind })).toBe(true);
    }
  });
});

describe("the isEntrySpan column's DEFAULT expression", () => {
  test("reads a row the way ingest decides it, for every case", () => {
    for (const entry of CASES) {
      // A non-string kind cannot be stored in the String column.
      if (entry.span.kind !== undefined && typeof entry.span.kind !== "string") {
        continue;
      }

      expect({ name: entry.name, isEntry: evaluateDefault(entry.span) }).toEqual(
        { name: entry.name, isEntry: entry.isEntry },
      );
    }
  });

  test("is exactly the expression the column is created and added with", () => {
    expect(IS_ENTRY_SPAN_DEFAULT_EXPRESSION).toBe(
      "isRootSpan OR (ifNull(kind, '') IN ('SPAN_KIND_SERVER', 'SPAN_KIND_CONSUMER'))",
    );
  });

  test("names the entry kinds from the same list ingest uses", () => {
    for (const kind of ENTRY_SPAN_KINDS) {
      expect(IS_ENTRY_SPAN_DEFAULT_EXPRESSION).toContain(`'${kind}'`);
    }
  });

  test("is well formed: one expression over isRootSpan and kind, balanced, quoted, no second statement", () => {
    const expression: string = IS_ENTRY_SPAN_DEFAULT_EXPRESSION;

    expect(expression).not.toContain(";");
    expect(expression).not.toContain("\n");
    expect(expression.split("'").length % 2).toBe(1);

    let depth: number = 0;
    for (const character of expression) {
      if (character === "(") {
        depth++;
      }
      if (character === ")") {
        depth--;
      }
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);

    // Outside quotes: the two columns, ifNull, and the keywords OR and IN.
    const unquoted: string = expression.replace(/'[^']*'/g, "''");
    const identifiers: Array<string> = unquoted.match(/[A-Za-z_]+/g) || [];
    expect(new Set(identifiers)).toEqual(
      new Set(["isRootSpan", "OR", "ifNull", "kind", "IN"]),
    );
  });

  test("never leaves a Nullable kind to decide: NULL IN (...) is NULL, which a Bool cannot hold", () => {
    expect(IS_ENTRY_SPAN_DEFAULT_EXPRESSION).toContain("ifNull(kind, '')");
    expect(IS_ENTRY_SPAN_DEFAULT_EXPRESSION).not.toMatch(/(^|[^(])kind IN/);
  });
});
