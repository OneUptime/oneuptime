import { describe, expect, test } from "@jest/globals";
import {
  ALL_LLM_USAGE_DIMENSIONS,
  LLM_USAGE_ROUTE,
  LlmUsageDimension,
  LlmUsageResponse,
  LlmUsageSource,
  emptyLlmUsageFigures,
  emptyLlmUsageResponse,
  readLlmUsageDimension,
  readLlmUsageResponse,
  readLlmUsageSource,
} from "../../../Types/Telemetry/LlmUsageApi";
import { LlmMetricUsageDimension } from "../../../Types/Telemetry/LlmMetricUsageApi";

/*
 * THE CONTRACT OF POST /telemetry/llm/usage.
 *
 * Both sides read the body defensively: a server mid-rollout, an older
 * Dashboard or a hand-made request degrades to "nothing", never to a crash
 * or a figure nobody measured.
 */

describe("the route and its words", () => {
  test("one address", () => {
    expect(LLM_USAGE_ROUTE).toBe("/telemetry/llm/usage");
  });

  test("every dimension, the totals alone first", () => {
    expect(ALL_LLM_USAGE_DIMENSIONS).toEqual([
      "none",
      "employee",
      "team",
      "model",
      "provider",
      "service",
    ]);
  });

  // The metric usage read groups by the same words: one vocabulary.
  test("the metric usage read's dimensions are these", () => {
    expect(LlmMetricUsageDimension).toBe(LlmUsageDimension);
  });

  test("a dimension it does not know reads as the totals alone", () => {
    expect(readLlmUsageDimension("employee")).toBe(LlmUsageDimension.Employee);
    expect(readLlmUsageDimension("service")).toBe(LlmUsageDimension.Service);
    expect(readLlmUsageDimension("Employee")).toBe(LlmUsageDimension.None);
    expect(readLlmUsageDimension("__proto__")).toBe(LlmUsageDimension.None);
    expect(readLlmUsageDimension(undefined)).toBe(LlmUsageDimension.None);
    expect(readLlmUsageDimension(3)).toBe(LlmUsageDimension.None);
  });

  test("a source it does not know reads as none", () => {
    for (const source of Object.values(LlmUsageSource)) {
      expect(readLlmUsageSource(source)).toBe(source);
    }

    expect(readLlmUsageSource("spans")).toBe(LlmUsageSource.None);
    expect(readLlmUsageSource(null)).toBe(LlmUsageSource.None);
  });
});

describe("the response, read defensively", () => {
  test("what the server sends reads back as it was sent", () => {
    const sent: LlmUsageResponse = {
      totals: {
        calls: 1240,
        erroredCalls: 15,
        inputTokens: 5970000,
        outputTokens: 816000,
        totalTokens: 6786000,
        costUsd: 72.75,
        tokenSource: LlmUsageSource.Both,
        costSource: LlmUsageSource.Both,
      },
      groups: [
        {
          ...emptyLlmUsageFigures(),
          key: "ana@example.com",
          costUsd: 49.1,
          costSource: LlmUsageSource.Both,
        },
      ],
      services: [
        {
          ...emptyLlmUsageFigures(),
          serviceId: "claude-code",
          costUsd: 52.25,
          costSource: LlmUsageSource.Metrics,
        },
      ],
      metricsLeftOut: true,
      truncated: true,
    };

    expect(readLlmUsageResponse(JSON.parse(JSON.stringify(sent)))).toEqual(
      sent,
    );
  });

  test("nothing, or not an object: nothing", () => {
    for (const value of [undefined, null, "usage", 5, [], true]) {
      expect(readLlmUsageResponse(value)).toEqual(emptyLlmUsageResponse());
    }
  });

  test("figures that are not numbers, or below zero, read as 0", () => {
    const read: LlmUsageResponse = readLlmUsageResponse({
      totals: {
        calls: "12",
        erroredCalls: -1,
        inputTokens: "many",
        outputTokens: null,
        totalTokens: Infinity,
        costUsd: -3,
        tokenSource: "spans",
        costSource: 4,
      },
    });

    expect(read.totals).toEqual({
      ...emptyLlmUsageFigures(),
      calls: 12,
    });
  });

  test("lists that are not lists, and entries that are not objects, are skipped", () => {
    const read: LlmUsageResponse = readLlmUsageResponse({
      groups: [null, "ana", 3, [], { key: "bo@example.com", costUsd: 2 }],
      services: { serviceId: "x" },
    });

    expect(read.groups).toEqual([
      { ...emptyLlmUsageFigures(), key: "bo@example.com", costUsd: 2 },
    ]);
    expect(read.services).toEqual([]);
  });

  test("a key or service id that is not a string reads as none", () => {
    const read: LlmUsageResponse = readLlmUsageResponse({
      groups: [{ key: 5, calls: 1 }],
      services: [{ serviceId: { id: "x" }, calls: 1 }],
    });

    expect(read.groups[0]!.key).toBe("");
    expect(read.services[0]!.serviceId).toBe("");
  });

  test("the flags are true only when the server said true", () => {
    expect(
      readLlmUsageResponse({ metricsLeftOut: "true", truncated: 1 }),
    ).toEqual(emptyLlmUsageResponse());
  });
});
