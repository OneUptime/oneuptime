import { z } from "zod";

/*
 * botbuilder, the Bot Framework SDK the Microsoft Teams integration is built
 * on, runs on zod 4.
 *
 * botbuilder 4.23.3 is the last release there will be: Microsoft archived
 * microsoft/botbuilder-js in January 2026. It was written for zod 3 and asks
 * for zod ^3.23.8, and every zod 3 is affected by GHSA-mrhx-c7xc-m3w5 (memory
 * exhaustion while validating a large array; fixed only in zod 4.6.6). So
 * Common's package.json overrides botbuilder's zod with Common's own zod 4,
 * one copy for the whole tree.
 *
 * zod 4 runs every schema botbuilder has but for two zod 3 names it dropped:
 *
 *   - ZodObject's nonstrict(), zod 3's older name for passthrough(): keep the
 *     keys a schema does not list. botbuilder's TeamsActivityHandler calls it
 *     while botbuilder is being loaded, and ConfigurationBotFrameworkAuthentication
 *     and ConfigurationServiceClientCredentialFactory call it when they are
 *     made, so without it botbuilder cannot be loaded at all
 *     ("z.object(...).nonstrict is not a function").
 *   - ZodError's errors, zod 3's older name for issues: what
 *     ConfigurationBotFrameworkAuthentication writes into its error when its
 *     settings do not parse. Without it that message is empty.
 *
 * addBotbuilderZod3Names puts both back on a zod, as zod 3 had them. zod 4
 * supports adding a method to a schema class's prototype (zod-to-openapi's
 * .openapi() is added the same way). A parse error is made from a prototype
 * zod keeps to itself, so errors is added there too, found through an error
 * made for the purpose. Both are added only when missing, so a zod that has
 * them already keeps its own.
 *
 * It has to run on botbuilder's zod before botbuilder is loaded: ./Botbuilder
 * imports this module first and then re-exports botbuilder, and nothing else
 * imports botbuilder (BotbuilderImportsGuard holds every file to that).
 */

type ZodNamespace = typeof z;

/*
 * The parse error prototypes: the one `new ZodError(...)` makes, and the one
 * a failed parse throws (zod makes those as real Errors, from a class of its
 * own). They can be the same object, so a Set.
 */
function zodErrorPrototypes(zod: ZodNamespace): Set<object> {
  const prototypes: Set<object> = new Set<object>([zod.ZodError.prototype]);
  const parseError: z.ZodError | undefined = zod.string().safeParse(0).error;

  if (parseError) {
    prototypes.add(Object.getPrototypeOf(parseError) as object);
  }

  return prototypes;
}

export function addBotbuilderZod3Names(zod: ZodNamespace): void {
  const objectPrototype: Record<string, unknown> = zod.ZodObject
    .prototype as unknown as Record<string, unknown>;

  if (typeof objectPrototype["nonstrict"] !== "function") {
    /*
     * A plain assignment, not defineProperty: zod 4 binds the prototype's own
     * enumerable functions onto each schema it makes.
     */
    objectPrototype["nonstrict"] = function nonstrict(
      this: z.ZodObject,
    ): z.ZodObject {
      return this.passthrough();
    };
  }

  for (const prototype of zodErrorPrototypes(zod)) {
    if (Object.prototype.hasOwnProperty.call(prototype, "errors")) {
      continue;
    }

    Object.defineProperty(prototype, "errors", {
      configurable: true,
      enumerable: false,
      get(this: z.ZodError): z.ZodError["issues"] {
        return this.issues;
      },
    });
  }
}

addBotbuilderZod3Names(z);
