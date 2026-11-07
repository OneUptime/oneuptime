import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ONE DEFINITION OF A QUEUE'S PUBLISHES AND CONSUMES.
 *
 * A queue's Overview and the Queues topology must count the same spans, or
 * a line on the map would disagree with the queue's own Producers and
 * Consumers cards. Both read the groups and the cards' combine rules from
 * Common/Types/MessageQueue/MessageQueueSpanPopulation: the Overview's
 * module re-exports them (its pages and suites read them from there), the
 * topology's server read compiles them. This suite fails when either grows a
 * copy of its own.
 */

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return { __esModule: true, default: {} };
});

import * as OverviewQueries from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueTelemetryQueries";
import * as Shared from "../../../Types/MessageQueue/MessageQueueSpanPopulation";

const REPO_PACKAGES: string = path.join(__dirname, "..", "..", "..", "..");

function source(...segments: Array<string>): string {
  return fs.readFileSync(path.join(REPO_PACKAGES, ...segments), "utf8");
}

describe("the Overview and the topology read one definition", () => {
  test.each([
    "MESSAGE_QUEUE_AWS_RPC_SYSTEMS",
    "MESSAGE_QUEUE_AWS_SEND_RPC_METHODS",
    "MESSAGE_QUEUE_BATCH_MESSAGE_COUNT_ATTRIBUTE",
    "MESSAGE_QUEUE_CLIENT_SPAN_KIND",
    "MESSAGE_QUEUE_CONSUME_SPAN_KIND",
    "MESSAGE_QUEUE_LEGACY_OPERATION_ATTRIBUTE",
    "MESSAGE_QUEUE_MILLISECONDS_PER_NANOSECOND",
    "MESSAGE_QUEUE_OPERATION_TYPE_ATTRIBUTE",
    "MESSAGE_QUEUE_POLLED_RECEIVE_SYSTEMS",
    "MESSAGE_QUEUE_PUBLISH_SPAN_KIND",
    "MESSAGE_QUEUE_RECEIVE_OPERATION",
    "MESSAGE_QUEUE_RPC_METHOD_ATTRIBUTE",
    "MESSAGE_QUEUE_SEND_OPERATIONS",
    "MESSAGE_QUEUE_SERVICE_LIMIT",
    "combineMessageQueueConsumerServices",
    "combineMessageQueueProducerServices",
    "isMessageQueueAwsRpcSystem",
    "isMessageQueuePolledReceiveSystem",
  ])("the Overview's %s is the shared one", (name: string) => {
    const fromOverview: unknown = (OverviewQueries as Record<string, unknown>)[
      name
    ];
    expect(fromOverview).toBeDefined();
    expect(fromOverview).toBe((Shared as Record<string, unknown>)[name]);
  });

  test("the Overview's module defines no group or combine rule of its own", () => {
    const overview: string = source(
      "App",
      "FeatureSet",
      "Dashboard",
      "src",
      "Components",
      "MessageQueue",
      "MessageQueueTelemetryQueries.ts",
    );
    for (const copy of [
      "export function combineMessageQueueProducerServices(",
      "export function combineMessageQueueConsumerServices(",
      "export function isMessageQueuePolledReceiveSystem(",
      "export const MESSAGE_QUEUE_PUBLISH_SPAN_KIND",
      "new IncludesNone([",
      "new GreaterThan<number>(0)",
    ]) {
      expect({ copy, found: overview.includes(copy) }).toEqual({
        copy,
        found: false,
      });
    }
    // Its groups' filters are the shared ones.
    expect(overview).toContain(
      "return getMessageQueueSpanPopulationFilter(population, system);",
    );
  });

  test("the topology's read compiles the shared filters and combines with the cards' rules", () => {
    const read: string = source(
      "Common",
      "Server",
      "Utils",
      "Telemetry",
      "MessageQueueTopology.ts",
    );
    expect(read).toContain(
      'from "../../../Types/MessageQueue/MessageQueueSpanPopulation";',
    );
    expect(read).toContain(
      "getMessageQueueSpanPopulationFilter(population, system)",
    );
    expect(read).toContain(
      "isMessageQueueSpanPopulationRead(population, system)",
    );
    expect(read).toContain("combineMessageQueueProducerServices({");
    expect(read).toContain("combineMessageQueueConsumerServices({");
    // No filter of its own: every condition is compiled by the query builder.
    expect(read).not.toMatch(/SPAN_KIND_(PRODUCER|CONSUMER|CLIENT)/);
    expect(read).not.toContain("messaging.batch.message_count");
  });

  test("both scale a p95 to milliseconds with the one factor, never by dividing", () => {
    const overview: string = source(
      "App",
      "FeatureSet",
      "Dashboard",
      "src",
      "Components",
      "MessageQueue",
      "MessageQueueTelemetryQueries.ts",
    );
    const read: string = source(
      "Common",
      "Server",
      "Utils",
      "Telemetry",
      "MessageQueueTopology.ts",
    );
    // The cards' p95s, the processing chart's and the tile's.
    for (const use of [
      /valuesByService\(\s*data\.p95Result,\s*MESSAGE_QUEUE_MILLISECONDS_PER_NANOSECOND,?\s*\)/,
      /aggregatedResultToTimePoints\(\s*p95Result,\s*MESSAGE_QUEUE_MILLISECONDS_PER_NANOSECOND,?\s*\)/,
      /firstFiniteValue\(\s*windowP95Result,\s*MESSAGE_QUEUE_MILLISECONDS_PER_NANOSECOND,?\s*\)/,
    ]) {
      expect(overview).toMatch(use);
    }
    expect(read).toContain(
      "number * MESSAGE_QUEUE_MILLISECONDS_PER_NANOSECOND",
    );
    const divides: RegExp = /\/\s*(1_000_000|1000000|1e6|NANOSECONDS)/;
    for (const [name, text] of [
      ["the Overview", overview],
      ["the topology", read],
    ] as Array<[string, string]>) {
      expect({
        name,
        divides: divides.test(text),
      }).toEqual({
        name,
        divides: false,
      });
    }
    // The two differ in the last bit for values an interpolated p95 takes.
    expect(
      22807691318 * Shared.MESSAGE_QUEUE_MILLISECONDS_PER_NANOSECOND,
    ).not.toBe(22807691318 / 1_000_000);
  });
});
