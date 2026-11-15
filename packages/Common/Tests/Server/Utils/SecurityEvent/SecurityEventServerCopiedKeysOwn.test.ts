import "../../TestingUtils/Init";
import { afterEach, describe, expect, test } from "@jest/globals";
import { INHERITED_PROPERTY_NAMES } from "../../../Helpers/InheritedNames";
import { toRequestTraceSpan } from "../../../../Server/Utils/SecurityEvent/RequestTrace/SecurityRequestTrace";
import { readRowMap } from "../../../../Server/Utils/SecurityEvent/TelemetryScan/TelemetryScanRows";
import SecurityWatchlistQueryBinder from "../../../../Server/Utils/SecurityEvent/Watchlists/SecurityWatchlistQueryBinder";
import { mergeDependencyEntityDescriptions } from "../../../../Server/Utils/Telemetry/ServiceDependencyDiscovery";
import { ExtractedEntity } from "../../../../Server/Utils/Telemetry/TelemetryEntity";
import Search from "../../../../Types/BaseDatabase/Search";
import { JSONObject } from "../../../../Types/JSON";
import EntityType from "../../../../Types/Telemetry/EntityType";
import { RequestTraceSpan } from "../../../../Utils/SecurityEvent/RequestOutcome";
import { readOwnValue } from "../../../../Utils/LookupTable";

/*
 * ISSUE #8486, ON THE SERVER: the telemetry scan's rows, a request's spans,
 * a watchlist-bound query's attributes and a dependency's descriptions are
 * maps keyed by what a sender wrote, and each copy writes every key as the
 * new map's own (writeOwnValue). An assignment dropped a key named
 * "__proto__" - and, for an object under it, made the object the copy's
 * prototype.
 *
 * Inputs are JSON text, as ClickHouse and a request hand them over, so a
 * "__proto__" key is the input's own; every test checks nothing was
 * written onto Object.prototype.
 */

const PROTOTYPE_KEYS: Array<string> = Object.getOwnPropertyNames(
  Object.prototype,
).sort();

afterEach(() => {
  expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(
    PROTOTYPE_KEYS,
  );
  expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
});

// `{ "<name>": "<value>", "team": "payments" }`, decoded.
function decoded(name: string, value: string): JSONObject {
  return JSON.parse(
    `{${JSON.stringify(name)}:${JSON.stringify(value)},"team":"payments"}`,
  ) as JSONObject;
}

function expectOwn(map: unknown, name: string, value: unknown): void {
  expect(Object.getPrototypeOf(map)).toBe(Object.prototype);
  expect(Object.keys(map as Record<string, unknown>)).toEqual([name, "team"]);
  expect({ name, value: readOwnValue(map as JSONObject, name) }).toEqual({
    name,
    value,
  });
}

describe("what the telemetry scan reads back (readRowMap)", () => {
  test.each(INHERITED_PROPERTY_NAMES)(
    "a row's attribute named %s is the map's own",
    (name: string) => {
      expectOwn(readRowMap(decoded(name, "the row's")), name, "the row's");
    },
  );

  test("a number or a yes/no under __proto__ is kept as its text", () => {
    const map: Record<string, string> = readRowMap(
      JSON.parse('{"__proto__":7,"team":true}') as JSONObject,
    );

    expect(readOwnValue(map, "__proto__")).toBe("7");
    expect(readOwnValue(map, "team")).toBe("true");
  });
});

describe("a request's spans, as a security event is followed into them (toRequestTraceSpan)", () => {
  test.each(INHERITED_PROPERTY_NAMES)(
    "a span's attribute named %s is the span's own",
    (name: string) => {
      const span: RequestTraceSpan = toRequestTraceSpan({
        spanId: "0af7651916cd43dd",
        name: "POST /login",
        attributes: decoded(name, "the span's"),
      });

      expectOwn(span.attributes, name, "the span's");
    },
  );
});

describe("a query bound to its watchlists (SecurityWatchlistQueryBinder.replace)", () => {
  test.each(INHERITED_PROPERTY_NAMES)(
    "an attribute filter named %s stays the query's own",
    (name: string) => {
      const bound: JSONObject = SecurityWatchlistQueryBinder.replace(
        { attributes: decoded(name, "x") } as JSONObject,
        new Map(),
      );

      expectOwn(bound["attributes"], name, "x");
    },
  );

  test("an operator under __proto__ is the filter's own, never the filter's prototype", () => {
    const attributes: JSONObject = {};

    Object.defineProperty(attributes, "__proto__", {
      value: new Search("admin"),
      enumerable: true,
      writable: true,
      configurable: true,
    });
    attributes["team"] = "payments";

    const bound: JSONObject = SecurityWatchlistQueryBinder.replace(
      { attributes } as JSONObject,
      new Map(),
    );
    const filter: JSONObject = bound["attributes"] as JSONObject;

    expect(Object.getPrototypeOf(filter)).toBe(Object.prototype);
    expect(Object.keys(filter)).toEqual(["__proto__", "team"]);
    expect(readOwnValue(filter, "__proto__")).toBeInstanceOf(Search);
  });
});

describe("two sightings of one dependency, merged (mergeDependencyEntityDescriptions)", () => {
  function sighting(descriptive: JSONObject): ExtractedEntity {
    return {
      entityType: EntityType.Database,
      entityKey: "0123456789abcdef",
      identifyingAttributes: {
        "db.system.name": "postgresql",
        "server.address": "db.example.com",
      },
      descriptiveAttributes: descriptive as Record<string, string>,
    };
  }

  test.each(INHERITED_PROPERTY_NAMES)(
    "a description named %s is the merge's own, the later sighting's winning",
    (name: string) => {
      const merged: ExtractedEntity = mergeDependencyEntityDescriptions(
        sighting(decoded(name, "earlier")),
        sighting(decoded(name, "later")),
      );

      expectOwn(merged.descriptiveAttributes, name, "later");
      expectOwn(
        mergeDependencyEntityDescriptions(
          sighting(decoded(name, "earlier")),
          sighting({}),
        ).descriptiveAttributes,
        name,
        "earlier",
      );
    },
  );
});
