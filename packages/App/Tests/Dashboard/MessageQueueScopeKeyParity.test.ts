import MessagingEntityKeyResolver from "../../FeatureSet/Telemetry/Services/MessagingEntityKeys";
import {
  MessageQueueScopeSource,
  getMessageQueueScopeKeys,
} from "../../FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueTelemetryScope";
import {
  DiscoveredMessageQueue,
  MessagingMetricDiscoveryRow,
  MessagingSpanDiscoveryRow,
  getMessagingDiscoveryColumn,
  resolveMessagingMetricDiscoveryRows,
  resolveMessagingSpanDiscoveryRows,
} from "Common/Server/Utils/Telemetry/MessageQueueDiscovery";
import {
  MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES,
  MESSAGING_RESOLVER_INPUT_ATTRIBUTES,
} from "Common/Types/MessageQueue/MessagingTelemetryResolver";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  FixtureAttributes,
  METRIC_FIXTURES,
  MetricFixture,
  SERVER,
  SPAN_FIXTURES,
  SpanFixture,
  toStoredColumns,
} from "Common/Tests/Types/MessageQueue/MessagingTelemetryFixtures";
import { describe, expect, test } from "@jest/globals";

/*
 * A queue page reads its telemetry by ONE entity key, which it builds from
 * the row's queueIdentifier (MessageQueueTelemetryScope). The row's
 * identifier comes from discovery; the key on the telemetry comes from the
 * ingest stamper. So the page finds its queue's spans and datapoints only if,
 * for every span and datapoint:
 *
 *   ingest's key == getMessageQueueScopeKeys(the row discovery creates)
 *
 * This drives the REAL pieces on the shared fixture corpus (real
 * instrumentations across semconv generations, live broker captures), in
 * the stored shape both sides read: the stamper's appendToSpanRow /
 * appendToMetricRow on a stored row (flattened attributes, resource keys
 * `resource.`-prefixed, the stored SpanKind), and discovery's row
 * resolution on the columns its SQL selects (toStoredColumns: what
 * ClickHouse's Map(String, String) hands back). Nothing re-derives the
 * stamper's recipe — a change to its gates or to how it builds the key
 * fails here. It also pins that the two agree on WHETHER there is a queue:
 * ingest stamps a key exactly when discovery would create a row.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5f2b7c1e-8d3a-4b6f-9c0d-1e2f3a4b5c6d",
);

// The columns a discovery query row carries: a<i> per resolver input key.
function discoveryColumns(
  attributes: FixtureAttributes,
  keys: ReadonlyArray<string>,
): Record<string, string> {
  const stored: Record<string, string> = toStoredColumns(attributes, keys);
  const columns: Record<string, string> = {};
  keys.forEach((key: string, index: number): void => {
    columns[getMessagingDiscoveryColumn(index)] = stored[key]!;
  });
  return columns;
}

// The keys the real stamper appends to a stored row.
function stampedKeys(
  row: JSONObject,
  stamp: (resolver: MessagingEntityKeyResolver, row: JSONObject) => void,
): Array<string> {
  stamp(new MessagingEntityKeyResolver(PROJECT_ID), row);
  return [...((row["entityKeys"] as Array<string>) || [])];
}

// The key set the page builds for the row discovery created.
function pageKeys(discovered: DiscoveredMessageQueue): Array<string> {
  const source: MessageQueueScopeSource = {
    projectId: PROJECT_ID,
    queueIdentifier: discovered.identifier,
  };
  return getMessageQueueScopeKeys(source);
}

const SPAN_CASES: Array<[string, SpanFixture]> = SPAN_FIXTURES.map(
  (fixture: SpanFixture): [string, SpanFixture] => {
    return [fixture.name, fixture];
  },
);

const METRIC_CASES: Array<[string, MetricFixture]> = METRIC_FIXTURES.map(
  (fixture: MetricFixture): [string, MetricFixture] => {
    return [fixture.name, fixture];
  },
);

describe("the page's key is the key ingest stamps, on the row discovery creates", () => {
  test("the corpus has spans and datapoints of queues, and some of nothing", () => {
    expect(SPAN_CASES.length).toBeGreaterThan(100);
    expect(METRIC_CASES.length).toBeGreaterThan(80);
    // Temporary, generated and placeholder destinations: no queue at all.
    expect(
      SPAN_FIXTURES.filter((fixture: SpanFixture): boolean => {
        return fixture.expected === null;
      }).length,
    ).toBeGreaterThan(10);
  });

  test("a SERVER span naming a queue gets no key, and makes no row", () => {
    const producer: SpanFixture = SPAN_FIXTURES.find(
      (fixture: SpanFixture): boolean => {
        return fixture.expected !== null;
      },
    )!;
    const row: JSONObject = {
      kind: SERVER,
      attributes: { ...producer.attributes },
      entityKeys: [],
    } as JSONObject;

    expect(
      new MessagingEntityKeyResolver(PROJECT_ID).appendToSpanRow(row),
    ).toBe(false);
    expect(row["entityKeys"]).toEqual([]);
    expect(
      resolveMessagingSpanDiscoveryRows([
        {
          kind: SERVER,
          spanCount: 5,
          errorCount: 0,
          ...discoveryColumns(
            producer.attributes,
            MESSAGING_RESOLVER_INPUT_ATTRIBUTES,
          ),
        },
      ]),
    ).toEqual([]);
  });

  test.each(SPAN_CASES)(
    "span %s",
    (_name: string, fixture: SpanFixture): void => {
      const stamped: Array<string> = stampedKeys(
        {
          kind: fixture.kind,
          attributes: { ...fixture.attributes },
          entityKeys: [],
        } as JSONObject,
        (resolver: MessagingEntityKeyResolver, row: JSONObject): void => {
          resolver.appendToSpanRow(row);
        },
      );
      const row: MessagingSpanDiscoveryRow = {
        kind: fixture.kind,
        spanCount: 5,
        errorCount: 0,
        ...discoveryColumns(
          fixture.attributes,
          MESSAGING_RESOLVER_INPUT_ATTRIBUTES,
        ),
      };
      const discovered: Array<DiscoveredMessageQueue> =
        resolveMessagingSpanDiscoveryRows([row]);

      // A key exactly when a row: no queue page without its telemetry.
      expect(discovered.length).toBe(stamped.length);
      expect(stamped.length).toBeLessThanOrEqual(1);
      if (stamped.length === 0) {
        return;
      }
      expect(pageKeys(discovered[0]!)).toEqual(stamped);
    },
  );

  test.each(METRIC_CASES)(
    "datapoint %s",
    (_name: string, fixture: MetricFixture): void => {
      const stamped: Array<string> = stampedKeys(
        {
          name: fixture.metricName,
          attributes: { ...fixture.attributes },
          entityKeys: [],
        } as JSONObject,
        (resolver: MessagingEntityKeyResolver, row: JSONObject): void => {
          resolver.appendToMetricRow(row);
        },
      );
      const row: MessagingMetricDiscoveryRow = {
        name: fixture.metricName,
        pointCount: 3,
        ...discoveryColumns(
          fixture.attributes,
          MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES,
        ),
      };
      const discovered: Array<DiscoveredMessageQueue> =
        resolveMessagingMetricDiscoveryRows([row]);

      expect(discovered.length).toBe(stamped.length);
      expect(stamped.length).toBeLessThanOrEqual(1);
      if (stamped.length === 0) {
        return;
      }
      expect(pageKeys(discovered[0]!)).toEqual(stamped);
    },
  );

  test("most of the corpus is a queue on both sides", () => {
    let spanQueues: number = 0;
    for (const fixture of SPAN_FIXTURES) {
      const row: JSONObject = {
        kind: fixture.kind,
        attributes: { ...fixture.attributes },
        entityKeys: [],
      } as JSONObject;
      new MessagingEntityKeyResolver(PROJECT_ID).appendToSpanRow(row);
      spanQueues += (row["entityKeys"] as Array<string>).length;
    }
    let metricQueues: number = 0;
    for (const fixture of METRIC_FIXTURES) {
      const row: JSONObject = {
        name: fixture.metricName,
        attributes: { ...fixture.attributes },
        entityKeys: [],
      } as JSONObject;
      new MessagingEntityKeyResolver(PROJECT_ID).appendToMetricRow(row);
      metricQueues += (row["entityKeys"] as Array<string>).length;
    }
    expect(spanQueues).toBeGreaterThan(90);
    expect(metricQueues).toBeGreaterThan(70);
  });
});
