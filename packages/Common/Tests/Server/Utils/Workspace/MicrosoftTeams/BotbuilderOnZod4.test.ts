import { describe, expect, test } from "@jest/globals";
import { z } from "zod";
import { addBotbuilderZod3Names } from "../../../../../Server/Utils/Workspace/MicrosoftTeams/BotbuilderOnZod4";

/*
 * The two zod 3 names botbuilder calls, put back on zod 4.
 *
 * Common runs botbuilder 4.23.3 - the last release, its repository archived
 * - on its own zod 4 (the package.json override), and botbuilder calls two
 * names zod 4 dropped: ZodObject's nonstrict() (zod 3's older name for
 * passthrough(), called while botbuilder loads) and ZodError's errors (zod
 * 3's older name for issues). BotbuilderOnZod4 adds both to the zod it
 * imports, which is the zod botbuilder loads, and these hold each to what
 * zod 3 did. BotbuilderOnZod4EndToEnd runs the real botbuilder on them.
 *
 * Importing BotbuilderOnZod4 added them to this file's zod (jest's copy of
 * Common's zod), so the tests below read them straight off zod.
 */

interface ObjectSchemaWithNonstrict {
  nonstrict: () => z.ZodObject;
}

interface ErrorWithErrors {
  errors: Array<z.core.$ZodIssue>;
}

function nonstrict(schema: z.ZodObject): z.ZodObject {
  return (schema as unknown as ObjectSchemaWithNonstrict).nonstrict();
}

function errorsOf(error: unknown): Array<z.core.$ZodIssue> {
  return (error as ErrorWithErrors).errors;
}

function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }

  throw new Error("expected it to throw");
}

describe("ZodObject's nonstrict(), as zod 3 had it", () => {
  test("every object schema has it", () => {
    expect(
      typeof (z.object({}) as unknown as ObjectSchemaWithNonstrict).nonstrict,
    ).toBe("function");
  });

  test("it keeps the keys the schema does not list, as passthrough() does", () => {
    const schema: z.ZodObject = z.object({ name: z.string() });

    expect(nonstrict(schema).parse({ name: "a", extra: 1 })).toEqual({
      name: "a",
      extra: 1,
    });
    expect(nonstrict(schema).parse({ name: "a", extra: 1 })).toEqual(
      schema.passthrough().parse({ name: "a", extra: 1 }),
    );
  });

  test("the schema itself still strips them: nonstrict() is a new schema", () => {
    const schema: z.ZodObject = z.object({ name: z.string() });

    nonstrict(schema);

    expect(schema.parse({ name: "a", extra: 1 })).toEqual({ name: "a" });
  });

  test("it still checks the keys the schema lists", () => {
    const result: { success: boolean } = nonstrict(
      z.object({ name: z.string() }),
    ).safeParse({ name: 5, extra: 1 });

    expect(result.success).toBe(false);
  });

  test("after partial(), the way botbuilder's configuration schemas use it", () => {
    /*
     * ConfigurationBotFrameworkAuthentication and
     * ConfigurationServiceClientCredentialFactory: z.object({...}).partial(),
     * then .nonstrict().parse(settings) on the settings they are given.
     */
    const settings: z.ZodObject = z
      .object({
        MicrosoftAppId: z.string(),
        MicrosoftAppPassword: z.string(),
        ValidateAuthority: z.union([z.string(), z.boolean()]),
      })
      .partial();

    expect(
      nonstrict(settings).parse({
        MicrosoftAppId: "app-id",
        ValidateAuthority: true,
        SomethingElse: "kept",
      }),
    ).toEqual({
      MicrosoftAppId: "app-id",
      ValidateAuthority: true,
      SomethingElse: "kept",
    });
    expect(nonstrict(settings).parse({})).toEqual({});
  });

  test("zod 4 hands a method added to ZodObject's prototype to schemas made before it, and to new ones", () => {
    /*
     * What nonstrict() relies on: it is added to the prototype once, and
     * reaches every object schema, whenever it was made. Checked with a
     * method of this test's own, so nonstrict() itself stays as it is.
     */
    const prototype: Record<string, unknown> = z.ZodObject
      .prototype as unknown as Record<string, unknown>;
    const madeBefore: z.ZodObject = z.object({ id: z.string() });

    prototype["botbuilderOnZod4Probe"] = function probe(
      this: z.ZodObject,
    ): Array<string> {
      return Object.keys(this.shape);
    };

    try {
      const madeAfter: z.ZodObject = z.object({ other: z.number() });

      expect(
        (
          madeBefore as unknown as { botbuilderOnZod4Probe: () => unknown }
        ).botbuilderOnZod4Probe(),
      ).toEqual(["id"]);
      expect(
        (
          madeAfter as unknown as { botbuilderOnZod4Probe: () => unknown }
        ).botbuilderOnZod4Probe(),
      ).toEqual(["other"]);
    } finally {
      delete prototype["botbuilderOnZod4Probe"];
    }
  });
});

describe("ZodError's errors, as zod 3 had it", () => {
  test("a parse error's errors are its issues", () => {
    const error: unknown = thrownBy(() => {
      return z.object({ name: z.string() }).parse({ name: 5 });
    });

    expect(error).toBeInstanceOf(z.ZodError);
    expect(errorsOf(error)).toBe((error as z.ZodError).issues);
    expect(errorsOf(error)).toHaveLength(1);
    expect(errorsOf(error)[0]?.path).toEqual(["name"]);
  });

  test("a safeParse error's errors are its issues", () => {
    const error: z.ZodError | undefined = z.string().safeParse(5).error;

    expect(errorsOf(error)).toBe(error?.issues);
  });

  test("an error made with new ZodError(...)'s errors are its issues", () => {
    const issues: Array<z.core.$ZodIssue> = [
      { code: "custom", message: "not a Logic", path: [], input: 1 },
    ];
    const error: z.ZodError = new z.ZodError(issues);

    expect(errorsOf(error)).toBe(error.issues);
  });

  test("errors is not one of the error's own keys: printing or serializing it changes nothing", () => {
    const error: z.ZodError | undefined = z.number().safeParse("x").error;

    expect(Object.keys(error as z.ZodError)).not.toContain("errors");
    expect(JSON.parse(JSON.stringify(error))).not.toHaveProperty("errors");
  });

  test("botbuilder's configuration error message lists the issues again", () => {
    /*
     * What ConfigurationBotFrameworkAuthentication does with a ZodError:
     * throw new Error(JSON.stringify(err.errors, null, 2)). Without errors,
     * JSON.stringify(undefined) is undefined, and the message is empty.
     */
    const error: unknown = thrownBy(() => {
      return z.object({ MicrosoftAppId: z.string() }).parse({
        MicrosoftAppId: 42,
      });
    });
    const message: string = new Error(JSON.stringify(errorsOf(error), null, 2))
      .message;

    expect(message).not.toBe("");
    expect(JSON.parse(message)).toEqual([
      expect.objectContaining({
        code: "invalid_type",
        path: ["MicrosoftAppId"],
      }),
    ]);
  });
});

describe("addBotbuilderZod3Names", () => {
  test("adding them again changes nothing", () => {
    const before: unknown = (
      z.ZodObject.prototype as unknown as Record<string, unknown>
    )["nonstrict"];

    addBotbuilderZod3Names(z);
    addBotbuilderZod3Names(z);

    expect(
      (z.ZodObject.prototype as unknown as Record<string, unknown>)[
        "nonstrict"
      ],
    ).toBe(before);
    expect(errorsOf(z.string().safeParse(1).error)).toHaveLength(1);
  });

  test("a zod that has them already keeps its own", () => {
    const ownNonstrict: () => string = (): string => {
      return "its own";
    };
    const ownErrors: PropertyDescriptor = {
      configurable: true,
      get(): string {
        return "its own errors";
      },
    };
    const errorPrototype: Record<string, unknown> = {};
    Object.defineProperty(errorPrototype, "errors", ownErrors);
    const objectPrototype: Record<string, unknown> = {
      nonstrict: ownNonstrict,
    };
    const fakeZod: typeof z = {
      ZodObject: { prototype: objectPrototype },
      ZodError: { prototype: errorPrototype },
      string: (): { safeParse: () => { error: undefined } } => {
        return {
          safeParse: (): { error: undefined } => {
            return { error: undefined };
          },
        };
      },
    } as unknown as typeof z;

    addBotbuilderZod3Names(fakeZod);

    expect(objectPrototype["nonstrict"]).toBe(ownNonstrict);
    expect(Object.getOwnPropertyDescriptor(errorPrototype, "errors")?.get).toBe(
      ownErrors.get,
    );
  });

  test("a zod without them gets both", () => {
    const errorPrototype: Record<string, unknown> = {};
    const objectPrototype: Record<string, unknown> = {};
    const fakeZod: typeof z = {
      ZodObject: { prototype: objectPrototype },
      ZodError: { prototype: errorPrototype },
      string: (): { safeParse: () => { error: undefined } } => {
        return {
          safeParse: (): { error: undefined } => {
            return { error: undefined };
          },
        };
      },
    } as unknown as typeof z;

    addBotbuilderZod3Names(fakeZod);

    expect(typeof objectPrototype["nonstrict"]).toBe("function");

    const withIssues: { issues: Array<string> } = Object.create(
      errorPrototype,
    ) as { issues: Array<string> };
    withIssues.issues = ["an issue"];

    expect((withIssues as unknown as { errors: unknown }).errors).toBe(
      withIssues.issues,
    );
  });
});
