import { describe, expect, test } from "@jest/globals";
import {
  extendZodWithOpenApi,
  getOpenApiMetadata,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import Zod from "../../../Utils/Schema/Zod";

/*
 * Common's Zod module: the zod functions OneUptime builds its schemas with,
 * picked by name, and zod-to-openapi's .openapi() on every zod schema.
 *
 * It hands zod's namespace to nothing, so a frontend bundle keeps only the
 * parts of zod the schemas use - zod 4's namespace carries all of its
 * locales, about 270 KB minified (ZodBrowserBundle holds the bundles to it).
 * These hold the module to what it says: the functions are zod's own, every
 * schema has .openapi(), and the one assumption it rests on - that
 * extendZodWithOpenApi reads nothing of zod but ZodType - still holds for
 * the installed zod-to-openapi.
 */

const PICKED: Array<string> = [
  "any",
  "array",
  "boolean",
  "date",
  "enum",
  "lazy",
  "literal",
  "number",
  "object",
  "string",
  "union",
];

describe("Common's Zod", () => {
  test("holds the zod functions OneUptime builds its schemas with, and no other", () => {
    expect(Object.keys(Zod).sort()).toEqual(PICKED);
  });

  test("each is zod's own function, not a copy or a wrapper", () => {
    for (const name of PICKED) {
      expect({
        name: name,
        same:
          (Zod as unknown as Record<string, unknown>)[name] ===
          z[name as keyof typeof z],
      }).toEqual({ name: name, same: true });
    }
  });

  test("every schema they make has .openapi(), and keeps what it is given", () => {
    const schemas: Array<[string, z.ZodType]> = [
      ["any", Zod.any()],
      ["array", Zod.array(Zod.string())],
      ["boolean", Zod.boolean()],
      ["date", Zod.date()],
      ["enum", Zod.enum(["ASC", "DESC"])],
      [
        "lazy",
        Zod.lazy(() => {
          return Zod.string();
        }),
      ],
      ["literal", Zod.literal("Email")],
      ["number", Zod.number()],
      ["object", Zod.object({ name: Zod.string() })],
      ["string", Zod.string()],
      ["union", Zod.union([Zod.string(), Zod.number()])],
    ];

    expect(
      schemas.map(([name]: [string, z.ZodType]): string => {
        return name;
      }),
    ).toEqual(PICKED);

    for (const [name, schema] of schemas) {
      const documented: z.ZodType = schema.openapi({
        description: `A ${name}.`,
        example: name,
      });

      expect({ name: name, metadata: getOpenApiMetadata(documented) }).toEqual({
        name: name,
        metadata: { description: `A ${name}.`, example: name },
      });
    }
  });

  test("a schema made with zod itself has .openapi() too: it is added to every zod type", () => {
    const record: z.ZodType = z
      .record(z.string(), z.number())
      .openapi({ type: "object" });

    expect(getOpenApiMetadata(record)).toEqual({ type: "object" });
  });

  test("extendZodWithOpenApi reads nothing of zod but ZodType - all Zod hands it", () => {
    /*
     * Zod.ts hands it { ZodType } instead of zod's namespace. If a
     * zod-to-openapi release reads more of zod (ZodObject, say), this fails
     * here, before every schema module fails at load with a TypeError.
     */
    class FakeZodType {}

    const read: Set<string> = new Set<string>();
    const fakeZod: typeof z = new Proxy(
      { ZodType: FakeZodType },
      {
        get: (
          target: { ZodType: typeof FakeZodType },
          property: string | symbol,
          receiver: unknown,
        ): unknown => {
          read.add(String(property));
          return Reflect.get(target, property, receiver);
        },
      },
    ) as unknown as typeof z;

    extendZodWithOpenApi(fakeZod);

    expect([...read]).toEqual(["ZodType"]);
    expect(
      typeof (FakeZodType.prototype as unknown as { openapi: unknown }).openapi,
    ).toBe("function");
  });
});
