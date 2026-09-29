import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  KubernetesCostAllocationIngestRow,
  KubernetesCostIngestPayload,
  MAX_KUBERNETES_COST_ALLOCATIONS_PER_REQUEST,
} from "../../../Types/Kubernetes/KubernetesCostIngest";

/*
 * KubernetesCostIngest is the wire contract for POST /kubernetes-cost/ingest.
 * The Kubernetes cost agent is a standalone project that cannot import
 * Common, so it carries a hand-written mirror of these interfaces
 * (agents/KubernetesCostAgent/Types.ts) with a "keep the two in sync" note.
 * These tests enforce that note mechanically and pin the request cap.
 */

const COMMON_SOURCE_PATH: string = path.resolve(
  __dirname,
  "../../../Types/Kubernetes/KubernetesCostIngest.ts",
);
const AGENT_MIRROR_PATH: string = path.resolve(
  __dirname,
  "../../../../../agents/KubernetesCostAgent/Types.ts",
);

interface FieldSignature {
  name: string;
  optional: boolean;
  type: string;
}

/*
 * Pull the top-level property signatures out of `export interface <name> {}`.
 * Comments are stripped first so prose containing ":" cannot masquerade as a
 * field. Neither contract interface nests object literal types, so a flat
 * line-based match over the interface body is sufficient.
 */
const extractInterfaceFields: (
  source: string,
  interfaceName: string,
) => Array<FieldSignature> = (
  source: string,
  interfaceName: string,
): Array<FieldSignature> => {
  const withoutComments: string = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  const header: string = `export interface ${interfaceName} {`;
  const start: number = withoutComments.indexOf(header);
  if (start === -1) {
    throw new Error(`interface ${interfaceName} not found`);
  }

  let depth: number = 0;
  let body: string = "";
  for (
    let i: number = start + header.length - 1;
    i < withoutComments.length;
    i++
  ) {
    const char: string = withoutComments[i]!;
    if (char === "{") {
      depth++;
      if (depth === 1) {
        continue;
      }
    }
    if (char === "}") {
      depth--;
      if (depth === 0) {
        break;
      }
    }
    body += char;
  }

  const fields: Array<FieldSignature> = [];
  const fieldPattern: RegExp = /^\s*([A-Za-z_$][\w$]*)(\?)?\s*:\s*([^;]+);/gm;
  let match: RegExpExecArray | null = fieldPattern.exec(body);
  while (match) {
    fields.push({
      name: match[1]!,
      optional: match[2] === "?",
      type: match[3]!.replace(/\s+/g, " ").trim(),
    });
    match = fieldPattern.exec(body);
  }
  return fields;
};

const byName: (
  fields: Array<FieldSignature>,
) => Record<string, FieldSignature> = (
  fields: Array<FieldSignature>,
): Record<string, FieldSignature> => {
  const result: Record<string, FieldSignature> = {};
  for (const field of fields) {
    result[field.name] = field;
  }
  return result;
};

describe("KubernetesCostIngest", () => {
  test("pins the per-request allocation cap", () => {
    expect(MAX_KUBERNETES_COST_ALLOCATIONS_PER_REQUEST).toBe(5000);
    expect(Number.isInteger(MAX_KUBERNETES_COST_ALLOCATIONS_PER_REQUEST)).toBe(
      true,
    );
  });

  test("a minimal payload only needs clusterName and allocations", () => {
    const row: KubernetesCostAllocationIngestRow = {
      windowStart: "2026-09-19T00:00:00Z",
      windowEnd: "2026-09-19T01:00:00Z",
    };
    const payload: KubernetesCostIngestPayload = {
      clusterName: "prod-eu",
      allocations: [row],
    };

    const roundTripped: KubernetesCostIngestPayload = JSON.parse(
      JSON.stringify(payload),
    ) as KubernetesCostIngestPayload;
    expect(roundTripped).toEqual(payload);
    expect(roundTripped.currency).toBeUndefined();
    expect(roundTripped.shipmentId).toBeUndefined();
  });

  test("a fully populated row survives a JSON round trip unchanged", () => {
    const row: KubernetesCostAllocationIngestRow = {
      windowStart: "2026-09-19T00:00:00Z",
      windowEnd: "2026-09-19T01:00:00Z",
      namespace: "checkout",
      controllerKind: "deployment",
      controllerName: "checkout-api",
      podName: "checkout-api-7c9d-abcde",
      containerName: "api",
      nodeName: "ip-10-0-0-1",
      providerId: "aws:///eu-west-1a/i-0123",
      labels: { app: "checkout", team: "payments" },
      cpuCoreHours: 0.5,
      cpuCoreRequestAverage: 0.5,
      cpuCoreUsageAverage: 0.2,
      cpuCoreLimitAverage: 1,
      gpuHours: 0,
      ramByteHours: 536870912,
      ramBytesRequestAverage: 536870912,
      ramBytesUsageAverage: 268435456,
      ramBytesLimitAverage: 1073741824,
      ramBytesUsageMax: 402653184,
      pvByteHours: 0,
      cpuCost: 0.012,
      gpuCost: 0,
      ramCost: 0.003,
      pvCost: 0,
      networkCost: 0.001,
      loadBalancerCost: 0,
      sharedCost: 0,
      externalCost: 0,
      totalCost: 0.016,
      cpuEfficiency: 0.4,
      ramEfficiency: 0.5,
      totalEfficiency: 0.42,
    };
    const payload: KubernetesCostIngestPayload = {
      clusterName: "prod-eu",
      currency: "USD",
      shipmentId: "sha256:abc",
      shipmentChunk: 0,
      allocations: [row, { ...row, namespace: "__idle__" }],
    };

    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });

  describe("agent mirror (agents/KubernetesCostAgent/Types.ts)", () => {
    const commonSource: string = fs.readFileSync(COMMON_SOURCE_PATH, "utf8");
    const agentSource: string = fs.readFileSync(AGENT_MIRROR_PATH, "utf8");

    test.each([
      "KubernetesCostAllocationIngestRow",
      "KubernetesCostIngestPayload",
    ])("%s declares the same fields, optionality and types", (name: string) => {
      const commonFields: Array<FieldSignature> = extractInterfaceFields(
        commonSource,
        name,
      );
      const agentFields: Array<FieldSignature> = extractInterfaceFields(
        agentSource,
        name,
      );

      // Guard against the parser silently returning nothing.
      expect(commonFields.length).toBeGreaterThan(2);

      expect(byName(agentFields)).toEqual(byName(commonFields));
    });

    test("the parser sees the fields the contract documents", () => {
      const rowFields: Record<string, FieldSignature> = byName(
        extractInterfaceFields(
          commonSource,
          "KubernetesCostAllocationIngestRow",
        ),
      );
      expect(rowFields["windowStart"]).toEqual({
        name: "windowStart",
        optional: false,
        type: "string",
      });
      expect(rowFields["ramBytesUsageMax"]).toEqual({
        name: "ramBytesUsageMax",
        optional: true,
        type: "number | undefined",
      });
      expect(rowFields["labels"]?.type).toBe(
        "Record<string, string> | undefined",
      );

      const payloadFields: Record<string, FieldSignature> = byName(
        extractInterfaceFields(commonSource, "KubernetesCostIngestPayload"),
      );
      expect(Object.keys(payloadFields).sort()).toEqual([
        "allocations",
        "clusterName",
        "currency",
        "shipmentChunk",
        "shipmentId",
      ]);
      expect(payloadFields["clusterName"]?.optional).toBe(false);
      expect(payloadFields["allocations"]?.optional).toBe(false);
    });
  });
});
