import { beforeAll, describe, expect, test } from "@jest/globals";
import crypto from "crypto";
import zlib from "zlib";
import OpenAPIUtil, {
  OpenAPISpecResponse,
} from "../../../Server/Utils/OpenAPI";
import { JSONObject, JSONValue } from "../../../Types/JSON";

/*
 * THE OPENAPI SPEC STAYS SMALL ENOUGH TO SERVE AND GENERATE FROM (#8853).
 *
 * GET /api/openapi/spec serves one document that describes every resource
 * the API has: its JSON, gzipped (OpenAPIUtil.getOpenAPISpecResponse). The
 * App builds it at boot, before it serves requests. Every SDK generator,
 * the Terraform and OpenTofu provider generator (Scripts/TerraformProvider)
 * and the API reference read the whole of it.
 *
 * Every resource adds its schemas and endpoints, so the spec grows with the
 * product. A budget is what stops it growing unnoticed, as
 * App/FeatureSet/MCP/Tests/ToolListBudget does for the MCP server's
 * tools/list. When a change goes over it, make the spec say less, or raise
 * the budget in the same change and say why beside it. The failure names
 * the biggest schemas and resources, which is where to start cutting.
 *
 * Measured as the API serves it: JSON.stringify of the document, and that
 * gzipped with zlib's defaults.
 */

/*
 * The budget for the JSON. 22,927,752 bytes on 2026-11-16, over 511
 * resources: 44,868 bytes each on average, so this leaves room for about 45
 * more of today's size (9%). The spec has grown fast - OpenAPI.ts's
 * comment measured 16.5 MB on 2026-10-28, three weeks before - so a tighter
 * budget would stop every other change.
 *
 * Raised on 2026-11-20, from 25,000,000. The spec was 24.66 MB, and every
 * resource then gained what created each record and who last modified it
 * (#10290): kept out of the read, query, select and sort schemas and the
 * reference (hideColumnInDocumentation), but in each resource's own model
 * schema, which lists every column a reader may read - 1.78 MB in all, to
 * 26,435,798 bytes. This leaves room for about 6% more.
 *
 * Lowered on 2026-11-23, back to 25,000,000 (#10527). The spec was 27.0 MB,
 * and three changes took it to 23.9 MB while it came to document those
 * columns on every resource: each of the six is described once, as a
 * schema of its own every resource refers to (ModelSchema
 * .RECORD_ACTOR_SCHEMA_NAMES), where its words and its permissions were on
 * each resource; a read-only field no longer carries the permissions
 * sentence that said "Create: [No access], Update: [No access]" of it (3.4
 * MB on 11,397 fields); and who deleted a record, which no record ever
 * held, is gone from every resource (#10469). This leaves room for about
 * 5% more.
 */
const MAX_SPEC_BYTES: number = 25_000_000;

/*
 * The budget for what is sent: 995,447 bytes gzipped on 2026-11-16, 1,948
 * a resource on average. This leaves room for about 53 more (10%).
 *
 * Raised on 2026-11-20, from 1,100,000: the spec had grown to 1,106,661
 * bytes gzipped, past it, and the record actor columns (#10290, above) took
 * it to 1,237,436. This leaves room for about 5% more.
 *
 * Lowered on 2026-11-23, from 1,300,000: the same three changes (#10527,
 * above) took it from 1,284,511 bytes to 1,110,163, with those columns
 * documented. This leaves room for about 8% more.
 */
const MAX_SPEC_GZIP_BYTES: number = 1_200_000;

/*
 * How far above the spec a budget may sit. A budget much bigger than what it
 * holds stops nothing: when the spec shrinks a lot, lower it in the same
 * change.
 */
const MAX_HEADROOM: number = 1.15;

// How many of the biggest schemas and resources a failure names.
const BIGGEST: number = 5;

interface SpecSize {
  bytes: number;
  gzipBytes: number;
}

interface Budget {
  bytes: number;
  gzipBytes: number;
}

const BUDGET: Budget = {
  bytes: MAX_SPEC_BYTES,
  gzipBytes: MAX_SPEC_GZIP_BYTES,
};

function bytesOf(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

// A spec's size as GET /api/openapi/spec serves it.
function sizeOf(spec: JSONObject): SpecSize {
  const json: Buffer = Buffer.from(JSON.stringify(spec), "utf8");

  return { bytes: json.length, gzipBytes: zlib.gzipSync(json).length };
}

function formatted(bytes: number): string {
  return bytes.toLocaleString("en-US");
}

// The biggest schemas, and the biggest resources by their endpoints.
function biggestOf(spec: JSONObject): {
  schemas: Array<string>;
  resources: Array<string>;
} {
  const schemas: Array<[string, number]> = Object.entries(
    ((spec["components"] as JSONObject)?.["schemas"] || {}) as JSONObject,
  ).map(([name, schema]: [string, JSONValue]): [string, number] => {
    return [name, bytesOf(schema)];
  });

  const byResource: Map<string, number> = new Map();

  for (const pathItem of Object.values((spec["paths"] || {}) as JSONObject)) {
    for (const operation of Object.values(pathItem as JSONObject)) {
      const tag: string =
        (
          (operation as JSONObject)?.["tags"] as Array<string> | undefined
        )?.[0] || "(untagged)";

      byResource.set(tag, (byResource.get(tag) || 0) + bytesOf(operation));
    }
  }

  const top: (entries: Array<[string, number]>) => Array<string> = (
    entries: Array<[string, number]>,
  ): Array<string> => {
    return [...entries]
      .sort((a: [string, number], b: [string, number]): number => {
        return b[1] - a[1];
      })
      .slice(0, BIGGEST)
      .map(([name, bytes]: [string, number]): string => {
        return `${name} (${formatted(bytes)} bytes)`;
      });
  };

  return { schemas: top(schemas), resources: top([...byResource.entries()]) };
}

/*
 * What is over budget, each with where to start cutting; none when the
 * spec is within it.
 */
function overBudget(spec: JSONObject, budget: Budget): Array<string> {
  const size: SpecSize = sizeOf(spec);
  const over: Array<string> = [];

  if (size.bytes > budget.bytes) {
    over.push(
      `The spec's JSON is ${formatted(size.bytes)} bytes, over its budget of ${formatted(budget.bytes)}.`,
    );
  }

  if (size.gzipBytes > budget.gzipBytes) {
    over.push(
      `The spec is ${formatted(size.gzipBytes)} bytes gzipped, over its budget of ${formatted(budget.gzipBytes)}.`,
    );
  }

  if (over.length === 0) {
    return [];
  }

  const biggest: { schemas: Array<string>; resources: Array<string> } =
    biggestOf(spec);

  return [
    ...over,
    `Its biggest schemas: ${biggest.schemas.join(", ")}.`,
    `Its biggest resources, by their endpoints: ${biggest.resources.join(", ")}.`,
  ];
}

// The spec with one more schema, as a change that grows it would.
function withSchema(
  spec: JSONObject,
  name: string,
  schema: JSONObject,
): JSONObject {
  const components: JSONObject = spec["components"] as JSONObject;

  return {
    ...spec,
    components: {
      ...components,
      schemas: { ...(components["schemas"] as JSONObject), [name]: schema },
    },
  };
}

describe("the OpenAPI spec's size", () => {
  let response: OpenAPISpecResponse;
  let spec: JSONObject = {};
  let size: SpecSize = { bytes: 0, gzipBytes: 0 };

  beforeAll(() => {
    response = OpenAPIUtil.getOpenAPISpecResponse();
    spec = JSON.parse(
      zlib.gunzipSync(response.gzip).toString("utf8"),
    ) as JSONObject;
    size = sizeOf(spec);
  }, 180000);

  test("is measured as GET /api/openapi/spec serves it", () => {
    expect(size).toEqual({
      bytes: response.bytes,
      gzipBytes: response.gzip.length,
    });
    // The whole product, so the budget measures something.
    expect(Object.keys(spec["paths"] as JSONObject).length).toBeGreaterThan(
      2000,
    );
  });

  test(`is at most ${formatted(MAX_SPEC_BYTES)} bytes of JSON, and ${formatted(MAX_SPEC_GZIP_BYTES)} gzipped`, () => {
    expect({ size, overBudget: overBudget(spec, BUDGET) }).toEqual({
      size,
      overBudget: [],
    });
  });

  test(`has a budget at most ${MAX_HEADROOM} times what it holds, so the budget still stops growth`, () => {
    expect({
      bytes: size.bytes,
      honest: MAX_SPEC_BYTES <= size.bytes * MAX_HEADROOM,
    }).toEqual({ bytes: size.bytes, honest: true });
    expect({
      gzipBytes: size.gzipBytes,
      honest: MAX_SPEC_GZIP_BYTES <= size.gzipBytes * MAX_HEADROOM,
    }).toEqual({ gzipBytes: size.gzipBytes, honest: true });
  });
});

/*
 * The checks above would pass anything if overBudget did. Each budget is
 * held on its own: text that gzip squeezes to nothing grows the JSON past
 * its budget and leaves what is sent within it, and random bytes grow what
 * is sent past its budget though the JSON stays within its own.
 */
describe("the budget, as a control", () => {
  let spec: JSONObject = {};
  let size: SpecSize = { bytes: 0, gzipBytes: 0 };

  beforeAll(() => {
    spec = JSON.parse(
      zlib
        .gunzipSync(OpenAPIUtil.getOpenAPISpecResponse().gzip)
        .toString("utf8"),
    ) as JSONObject;
    size = sizeOf(spec);
  }, 180000);

  test("refuses JSON grown past its budget, and names the schema that grew it first", () => {
    const grown: JSONObject = withSchema(spec, "PaddingSchema", {
      type: "object",
      description: "a".repeat(MAX_SPEC_BYTES - size.bytes + 1),
    });
    const grownSize: SpecSize = sizeOf(grown);

    expect(grownSize.bytes).toBeGreaterThan(MAX_SPEC_BYTES);
    expect(grownSize.gzipBytes).toBeLessThanOrEqual(MAX_SPEC_GZIP_BYTES);

    const over: Array<string> = overBudget(grown, BUDGET);

    expect(over).toHaveLength(3);
    expect(over[0]).toBe(
      `The spec's JSON is ${formatted(grownSize.bytes)} bytes, over its budget of ${formatted(MAX_SPEC_BYTES)}.`,
    );
    expect(over[1]).toMatch(/^Its biggest schemas: PaddingSchema \(/);
    expect(over[2]).toMatch(/^Its biggest resources, by their endpoints: /);
  });

  test("refuses what is sent grown past its budget, though the JSON is within its own", () => {
    // Random bytes, which gzip cannot squeeze, as base64 text.
    const padding: string = crypto
      .randomBytes(MAX_SPEC_GZIP_BYTES - size.gzipBytes + 5000)
      .toString("base64");
    const grown: JSONObject = withSchema(spec, "PaddingSchema", {
      type: "object",
      description: padding,
    });
    const grownSize: SpecSize = sizeOf(grown);

    expect(grownSize.bytes).toBeLessThanOrEqual(MAX_SPEC_BYTES);
    expect(grownSize.gzipBytes).toBeGreaterThan(MAX_SPEC_GZIP_BYTES);

    const over: Array<string> = overBudget(grown, BUDGET);

    expect(over[0]).toBe(
      `The spec is ${formatted(grownSize.gzipBytes)} bytes gzipped, over its budget of ${formatted(MAX_SPEC_GZIP_BYTES)}.`,
    );
    expect(over).toHaveLength(3);
  });

  test("takes a spec grown within the budget, and one exactly at it", () => {
    const grown: JSONObject = withSchema(spec, "OneMoreSchema", {
      type: "object",
      description: "a".repeat(1000),
    });

    expect(overBudget(grown, BUDGET)).toEqual([]);

    const grownSize: SpecSize = sizeOf(grown);

    expect(overBudget(grown, grownSize)).toEqual([]);
    expect(
      overBudget(grown, { ...grownSize, bytes: grownSize.bytes - 1 }),
    ).toHaveLength(3);
    expect(
      overBudget(grown, { ...grownSize, gzipBytes: grownSize.gzipBytes - 1 }),
    ).toHaveLength(3);
  });
});
