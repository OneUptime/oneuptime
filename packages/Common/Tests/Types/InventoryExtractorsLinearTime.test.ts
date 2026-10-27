import {
  ExtractedDockerSwarmInventoryRecord,
  extractDockerSwarmInventoryResource,
} from "../../Types/DockerSwarm/DockerSwarmInventoryExtractor";
import {
  ParsedKubernetesContainerRow,
  extractContainersFromPod,
} from "../../Types/Kubernetes/KubernetesInventoryExtractor";
import { KubernetesPodObject } from "../../Types/Kubernetes/KubernetesObjectParser";
import { generatedTexts } from "../Helpers/GeneratedTexts";
import { namedPattern, patternWith } from "../Helpers/SourcePatterns";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../Helpers/FastestRun";

/*
 * ---------------------------------------------------------------------------
 * WHAT AN AGENT REPORTS IS READ AT INGEST IN TIME IN LINE WITH ITS LENGTH.
 *
 * The Docker Swarm and Kubernetes agents report their resources as log
 * records, and the shared ingest reads each one: a service's "X/Y"
 * replicas, a container's memory limit. Anyone holding the project's
 * ingestion key can send any text there. Both patterns read a long run of
 * digits again from each of its digits; each now reads it once, and reads
 * the same numbers out of every value it read them out of before.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400000;

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

const replicasOf: (
  replicas: string,
) => ExtractedDockerSwarmInventoryRecord | null = (
  replicas: string,
): ExtractedDockerSwarmInventoryRecord | null => {
  return extractDockerSwarmInventoryResource({
    kind: "Service",
    logBody: JSON.stringify({
      kind: "Service",
      data: { ID: "svc1", Name: "api", Replicas: replicas },
    }),
    lastSeenAt: new Date("2026-06-15T12:00:00.000Z"),
  });
};

const memoryOf: (memory: string) => number | null = (
  memory: string,
): number | null => {
  const rows: Array<ParsedKubernetesContainerRow> = extractContainersFromPod({
    parsedPod: {
      metadata: { name: "p", namespace: "n" },
      spec: {
        containers: [{ name: "c", resources: { limits: { memory } } }],
      },
    } as unknown as KubernetesPodObject,
    lastSeenAt: new Date("2026-07-31T12:00:00.000Z"),
  });

  return rows[0]!.memoryLimitBytes;
};

describe("a reported value is read in time in line with its length", () => {
  test.each([
    ["digits and no slash", repeat("0", LENGTH)],
    ["digits, spaces and no second number", repeat("1", LENGTH) + " / x"],
    ["runs of digits between words", repeat("12a", LENGTH)],
  ])("Docker Swarm replicas: %s", (_label: string, replicas: string) => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        replicasOf(replicas);
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });

  test.each([
    ["digits and a dot", repeat("0", LENGTH) + "."],
    ["digits, a dot and a letter", repeat("1", LENGTH) + ".x"],
    ["digits, white space and a digit", repeat("2", LENGTH) + " 1"],
  ])("Kubernetes memory limit: %s", (_label: string, memory: string) => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        memoryOf(memory);
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("the numbers are read as they were", () => {
  test("replicas", () => {
    expect(replicasOf("3/5")).toMatchObject({
      resource: { runningReplicas: 3, desiredReplicas: 5 },
    });
    expect(replicasOf("replicated 10 / 12 (max 1 per node)")).toMatchObject({
      resource: { runningReplicas: 10, desiredReplicas: 12 },
    });
    expect(replicasOf("n/a")).toMatchObject({
      resource: { runningReplicas: null, desiredReplicas: null },
    });
  });

  test("memory limits", () => {
    expect(memoryOf("256Mi")).toBe(256 * 1024 * 1024);
    expect(memoryOf("1.5Gi")).toBe(Math.round(1.5 * 1024 * 1024 * 1024));
    expect(memoryOf(".5Gi")).toBe(Math.round(0.5 * 1024 * 1024 * 1024));
    expect(memoryOf("2048")).toBe(2048);
    expect(memoryOf("1.")).toBeNull();
    expect(memoryOf("1.2.3")).toBeNull();
  });
});

/*
 * The patterns as they were: the reference the ones the product runs (read
 * from its source) must agree with, group for group.
 */
describe("each pattern reads exactly what it read before", () => {
  test("replicas, on forty thousand drawn values", () => {
    const before: RegExp = /(\d+)\s*\/\s*(\d+)/;
    const now: RegExp = patternWith(
      "packages/Common/Types/DockerSwarm/DockerSwarmInventoryExtractor.ts",
      "\\s*\\/\\s*",
    );
    const mismatches: Array<{ value: string; now: string; before: string }> =
      [];
    let matched: number = 0;

    for (const value of generatedTexts(
      40000,
      6006,
      ["1", "23", "0", "/", " ", "\t", "a", "-", "x/", "/0"],
      12,
    )) {
      const expected: RegExpMatchArray | null = value.match(before);
      const actual: RegExpMatchArray | null = value.match(now);
      const expectedText: string = expected
        ? `${expected[1]}/${expected[2]}`
        : "none";
      const actualText: string = actual ? `${actual[1]}/${actual[2]}` : "none";

      if (expected) {
        matched++;
      }

      if (actualText !== expectedText) {
        mismatches.push({ value, now: actualText, before: expectedText });
      }
    }

    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(matched).toBeGreaterThan(5000);
  });

  test("memory limits, on forty thousand drawn values", () => {
    const before: RegExp = /^([0-9]*\.?[0-9]+)\s*([A-Za-z]+)?$/;
    const now: RegExp = patternWith(
      "packages/Common/Types/Kubernetes/KubernetesInventoryExtractor.ts",
      "[A-Za-z]+)?$",
    );
    const mismatches: Array<{ value: string; now: string; before: string }> =
      [];
    let matched: number = 0;

    for (const value of generatedTexts(
      40000,
      7007,
      ["1", "1", "25", "0", ".", " ", "\t", "Mi", "G", "k", "e", "x"],
      7,
    )) {
      const expected: string = JSON.stringify(value.match(before));
      const actual: string = JSON.stringify(value.match(now));

      if (expected !== "null") {
        matched++;
      }

      if (actual !== expected) {
        mismatches.push({ value, now: actual, before: expected });
      }
    }

    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(matched).toBeGreaterThan(5000);
  });

  test("the reading helpers find the patterns they compare", () => {
    expect(() => {
      return namedPattern(
        "packages/Common/Types/Kubernetes/KubernetesInventoryExtractor.ts",
        "NO_SUCH_PATTERN",
      );
    }).toThrow("assigns 0 patterns to NO_SUCH_PATTERN, not one.");
  });
});
