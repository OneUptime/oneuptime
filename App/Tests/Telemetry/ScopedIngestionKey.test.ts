import {
  IotFleetScopeViolation,
  checkResourceAgainstFleetScope,
  findIotFleetScopeViolation,
  getConflictingIotFleetAttribution,
  getIotFleetNameFromResourceAttributes,
  getResourceEnvelopesFromOtelBody,
  getResourceEnvelopeKeyForProductType,
  isFleetScoped,
  normalizeIotFleetNames,
} from "../../FeatureSet/Telemetry/Utils/IotFleetScope";
import OtelIngestBaseService from "../../FeatureSet/Telemetry/Services/OtelIngestBaseService";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import { describe, expect, test } from "@jest/globals";

/*
 * Expose the REAL ingest attribution resolver (protected static on the
 * abstract base) so the parity tests below pin the scope check to the
 * exact fleet name the ingest path will attribute data to. If these
 * two ever diverge, a scoped key can pass the scope gate while ingest
 * files the data under a different fleet — a full scope escape.
 */
class ExposedOtelIngestBaseService extends OtelIngestBaseService {
  public static resolveFleetNameLikeIngestDoes(
    attributes: JSONArray,
  ): string | null {
    return this.getIoTFleetNameFromAttributes(attributes);
  }
}

/*
 * Pure-helper tests for IoT-fleet-scoped telemetry ingestion keys.
 * These cover the enforcement matrix without any infrastructure:
 *   - scoped key + matching fleet          → pass
 *   - scoped key + wrong fleet             → reject (names fleet + scope)
 *   - scoped key + missing fleet attribute → reject (fail closed)
 *   - unscoped key                         → never rejects (today's behavior)
 */

function resourceEnvelope(attributes: JSONArray): JSONObject {
  return { resource: { attributes } } as JSONObject;
}

function fleetAttribute(fleetName: string): JSONObject {
  return {
    key: "iot.fleet.name",
    value: { stringValue: fleetName },
  } as JSONObject;
}

function aliasFleetAttribute(fleetName: string): JSONObject {
  return {
    key: "resource.iot.fleet.name",
    value: { stringValue: fleetName },
  } as JSONObject;
}

const serviceNameAttribute: JSONObject = {
  key: "service.name",
  value: { stringValue: "iot/building-a-sensors" },
} as JSONObject;

describe("normalizeIotFleetNames", () => {
  test("null / undefined / non-array input is unscoped ([])", () => {
    expect(normalizeIotFleetNames(null)).toEqual([]);
    expect(normalizeIotFleetNames(undefined)).toEqual([]);
    expect(normalizeIotFleetNames("building-a-sensors")).toEqual([]);
    expect(normalizeIotFleetNames({})).toEqual([]);
    expect(normalizeIotFleetNames(42)).toEqual([]);
  });

  test("empty array stays unscoped", () => {
    expect(normalizeIotFleetNames([])).toEqual([]);
  });

  test("trims entries, drops empties / non-strings, de-duplicates", () => {
    expect(
      normalizeIotFleetNames([
        "  building-a-sensors ",
        "",
        "   ",
        null,
        7,
        "field-gateways",
        "building-a-sensors",
      ]),
    ).toEqual(["building-a-sensors", "field-gateways"]);
  });

  test("isFleetScoped reflects the normalized list", () => {
    expect(isFleetScoped([])).toBe(false);
    expect(isFleetScoped(["building-a-sensors"])).toBe(true);
  });
});

describe("getIotFleetNameFromResourceAttributes", () => {
  test("reads iot.fleet.name stringValue", () => {
    expect(
      getIotFleetNameFromResourceAttributes([
        serviceNameAttribute,
        fleetAttribute("building-a-sensors"),
      ]),
    ).toBe("building-a-sensors");
  });

  test("accepts the resource.-prefixed alias", () => {
    expect(
      getIotFleetNameFromResourceAttributes([
        {
          key: "resource.iot.fleet.name",
          value: { stringValue: "field-gateways" },
        } as JSONObject,
      ]),
    ).toBe("field-gateways");
  });

  test("returns null for missing / empty / non-string values", () => {
    expect(getIotFleetNameFromResourceAttributes([])).toBeNull();
    expect(getIotFleetNameFromResourceAttributes(null)).toBeNull();
    expect(getIotFleetNameFromResourceAttributes(undefined)).toBeNull();
    expect(
      getIotFleetNameFromResourceAttributes([serviceNameAttribute]),
    ).toBeNull();
    expect(
      getIotFleetNameFromResourceAttributes([
        { key: "iot.fleet.name", value: { stringValue: "   " } } as JSONObject,
      ]),
    ).toBeNull();
    expect(
      getIotFleetNameFromResourceAttributes([
        { key: "iot.fleet.name", value: { intValue: 5 } } as JSONObject,
      ]),
    ).toBeNull();
  });

  test("trims the fleet name", () => {
    expect(
      getIotFleetNameFromResourceAttributes([
        fleetAttribute("  building-a-sensors  "),
      ]),
    ).toBe("building-a-sensors");
  });
});

describe("key-priority parity with the ingest attribution path (security)", () => {
  /*
   * The ingest path (OtelIngestBaseService.getIoTFleetNameFromAttributes)
   * ALWAYS prefers the canonical `iot.fleet.name` key across the whole
   * array and only falls back to the `resource.`-prefixed alias when no
   * non-empty canonical attribute exists. The scope check MUST resolve
   * identically, or a scoped key can order both keys so the scope gate
   * approves one fleet while ingest attributes the data to another.
   */

  test("canonical key wins over the alias even when the alias comes FIRST in array order (scope-escape regression)", () => {
    const attributes: JSONArray = [
      aliasFleetAttribute("building-a-sensors"), // in scope, first in array
      fleetAttribute("production-critical"), // out of scope, later in array
    ];

    // The resolver must pick what ingest will attribute: the canonical key.
    expect(getIotFleetNameFromResourceAttributes(attributes)).toBe(
      "production-critical",
    );

    // And the scoped check must therefore REJECT this payload.
    const violation: IotFleetScopeViolation | null = findIotFleetScopeViolation(
      {
        allowedIotFleetNames: ["building-a-sensors"],
        resourceEnvelopes: [resourceEnvelope(attributes)],
      },
    );
    expect(violation).not.toBeNull();
    expect(violation!.message).toContain('"production-critical"');
  });

  test("whitespace-only canonical value falls through to the alias (getStringAttribute semantics)", () => {
    const attributes: JSONArray = [
      { key: "iot.fleet.name", value: { stringValue: "   " } } as JSONObject,
      aliasFleetAttribute("field-gateways"),
    ];

    expect(getIotFleetNameFromResourceAttributes(attributes)).toBe(
      "field-gateways",
    );

    // No conflict (the canonical key resolves to nothing) → in-scope passes.
    expect(
      checkResourceAgainstFleetScope({
        allowedIotFleetNames: ["field-gateways"],
        resourceAttributes: attributes,
      }),
    ).toBeNull();
  });

  test("duplicate canonical keys: first non-empty value wins", () => {
    expect(
      getIotFleetNameFromResourceAttributes([
        { key: "iot.fleet.name", value: { stringValue: "" } } as JSONObject,
        fleetAttribute("building-a-sensors"),
        fleetAttribute("later-duplicate"),
      ]),
    ).toBe("building-a-sensors");
  });

  test("resolver matches the REAL ingest resolver across attribute permutations", () => {
    const cases: Array<JSONArray> = [
      [aliasFleetAttribute("allowed"), fleetAttribute("evil")],
      [fleetAttribute("evil"), aliasFleetAttribute("allowed")],
      [aliasFleetAttribute("only-alias")],
      [fleetAttribute("only-canonical")],
      [
        { key: "iot.fleet.name", value: { stringValue: " " } } as JSONObject,
        aliasFleetAttribute("alias-after-blank"),
      ],
      [
        { key: "iot.fleet.name", value: { intValue: 5 } } as JSONObject,
        aliasFleetAttribute("alias-after-non-string"),
      ],
      [
        { key: "iot.fleet.name", value: { stringValue: "" } } as JSONObject,
        fleetAttribute("second-canonical"),
      ],
      [serviceNameAttribute],
      [],
      [fleetAttribute("  padded  "), aliasFleetAttribute("padded")],
    ];

    for (const attributes of cases) {
      expect(getIotFleetNameFromResourceAttributes(attributes)).toBe(
        ExposedOtelIngestBaseService.resolveFleetNameLikeIngestDoes(attributes),
      );
    }
  });
});

describe("conflicting fleet attribution (belt and braces)", () => {
  test("detects both keys with different values regardless of order", () => {
    expect(
      getConflictingIotFleetAttribution([
        aliasFleetAttribute("fleet-b"),
        fleetAttribute("fleet-a"),
      ]),
    ).toEqual({
      canonicalFleetName: "fleet-a",
      aliasFleetName: "fleet-b",
    });
  });

  test("no conflict when values match, or when either key is absent/empty", () => {
    expect(
      getConflictingIotFleetAttribution([
        fleetAttribute("fleet-a"),
        aliasFleetAttribute("fleet-a"),
      ]),
    ).toBeNull();
    expect(
      getConflictingIotFleetAttribution([fleetAttribute("fleet-a")]),
    ).toBeNull();
    expect(
      getConflictingIotFleetAttribution([aliasFleetAttribute("fleet-b")]),
    ).toBeNull();
    expect(
      getConflictingIotFleetAttribution([
        { key: "iot.fleet.name", value: { stringValue: " " } } as JSONObject,
        aliasFleetAttribute("fleet-b"),
      ]),
    ).toBeNull();
    expect(getConflictingIotFleetAttribution(null)).toBeNull();
    expect(getConflictingIotFleetAttribution(undefined)).toBeNull();
  });

  test("scoped key rejects conflicting attribution even when BOTH values are in scope", () => {
    const violation: IotFleetScopeViolation | null =
      checkResourceAgainstFleetScope({
        allowedIotFleetNames: ["fleet-a", "fleet-b"],
        resourceAttributes: [
          fleetAttribute("fleet-a"),
          aliasFleetAttribute("fleet-b"),
        ],
      });

    expect(violation).not.toBeNull();
    expect(violation!.offendingFleetName).toBe("fleet-a");
    expect(violation!.message).toContain("conflicting fleet attribution");
    expect(violation!.message).toContain('"fleet-a"');
    expect(violation!.message).toContain('"fleet-b"');
  });

  test("matching canonical + alias values pass for a scoped key", () => {
    expect(
      checkResourceAgainstFleetScope({
        allowedIotFleetNames: ["fleet-a"],
        resourceAttributes: [
          aliasFleetAttribute("fleet-a"),
          fleetAttribute("fleet-a"),
        ],
      }),
    ).toBeNull();
  });

  test("unscoped keys still ignore conflicting attribution (today's behavior)", () => {
    expect(
      checkResourceAgainstFleetScope({
        allowedIotFleetNames: [],
        resourceAttributes: [
          fleetAttribute("fleet-a"),
          aliasFleetAttribute("fleet-b"),
        ],
      }),
    ).toBeNull();
  });
});

describe("checkResourceAgainstFleetScope", () => {
  test("scoped key + matching fleet passes", () => {
    expect(
      checkResourceAgainstFleetScope({
        allowedIotFleetNames: ["building-a-sensors", "field-gateways"],
        resourceAttributes: [fleetAttribute("building-a-sensors")],
      }),
    ).toBeNull();
  });

  test("scoped key + wrong fleet rejects, naming fleet and scope", () => {
    const violation: IotFleetScopeViolation | null =
      checkResourceAgainstFleetScope({
        allowedIotFleetNames: ["building-a-sensors"],
        resourceAttributes: [fleetAttribute("some-other-fleet")],
      });

    expect(violation).not.toBeNull();
    expect(violation!.offendingFleetName).toBe("some-other-fleet");
    expect(violation!.message).toContain('"some-other-fleet"');
    expect(violation!.message).toContain('"building-a-sensors"');
  });

  test("scoped key + missing fleet attribute rejects (fail closed)", () => {
    const violation: IotFleetScopeViolation | null =
      checkResourceAgainstFleetScope({
        allowedIotFleetNames: ["building-a-sensors"],
        resourceAttributes: [serviceNameAttribute],
      });

    expect(violation).not.toBeNull();
    expect(violation!.offendingFleetName).toBeNull();
    expect(violation!.message).toContain("no iot.fleet.name");
    expect(violation!.message).toContain('"building-a-sensors"');
  });

  test("unscoped key ignores everything", () => {
    expect(
      checkResourceAgainstFleetScope({
        allowedIotFleetNames: [],
        resourceAttributes: [fleetAttribute("any-fleet-at-all")],
      }),
    ).toBeNull();
    expect(
      checkResourceAgainstFleetScope({
        allowedIotFleetNames: [],
        resourceAttributes: [],
      }),
    ).toBeNull();
    expect(
      checkResourceAgainstFleetScope({
        allowedIotFleetNames: [],
        resourceAttributes: undefined,
      }),
    ).toBeNull();
  });
});

describe("findIotFleetScopeViolation", () => {
  test("all resources in scope passes", () => {
    expect(
      findIotFleetScopeViolation({
        allowedIotFleetNames: ["building-a-sensors", "field-gateways"],
        resourceEnvelopes: [
          resourceEnvelope([fleetAttribute("building-a-sensors")]),
          resourceEnvelope([fleetAttribute("field-gateways")]),
        ],
      }),
    ).toBeNull();
  });

  test("one out-of-scope resource rejects the whole payload", () => {
    const violation: IotFleetScopeViolation | null = findIotFleetScopeViolation(
      {
        allowedIotFleetNames: ["building-a-sensors"],
        resourceEnvelopes: [
          resourceEnvelope([fleetAttribute("building-a-sensors")]),
          resourceEnvelope([fleetAttribute("intruder-fleet")]),
        ],
      },
    );

    expect(violation).not.toBeNull();
    expect(violation!.offendingFleetName).toBe("intruder-fleet");
  });

  test("a resource without attributes rejects for a scoped key", () => {
    const violation: IotFleetScopeViolation | null = findIotFleetScopeViolation(
      {
        allowedIotFleetNames: ["building-a-sensors"],
        resourceEnvelopes: [
          {} as JSONObject,
          {
            resource: {},
          } as JSONObject,
        ],
      },
    );

    expect(violation).not.toBeNull();
    expect(violation!.offendingFleetName).toBeNull();
  });

  test("unscoped key never rejects, no matter the payload", () => {
    expect(
      findIotFleetScopeViolation({
        allowedIotFleetNames: [],
        resourceEnvelopes: [
          resourceEnvelope([fleetAttribute("whatever")]),
          {} as JSONObject,
        ],
      }),
    ).toBeNull();
  });

  test("empty payload passes even for a scoped key", () => {
    expect(
      findIotFleetScopeViolation({
        allowedIotFleetNames: ["building-a-sensors"],
        resourceEnvelopes: [],
      }),
    ).toBeNull();
  });
});

describe("OTLP body helpers", () => {
  test("resource envelope key per product type", () => {
    expect(getResourceEnvelopeKeyForProductType(ProductType.Traces)).toBe(
      "resourceSpans",
    );
    expect(getResourceEnvelopeKeyForProductType(ProductType.Logs)).toBe(
      "resourceLogs",
    );
    expect(getResourceEnvelopeKeyForProductType(ProductType.Metrics)).toBe(
      "resourceMetrics",
    );
    expect(getResourceEnvelopeKeyForProductType(ProductType.Profiles)).toBe(
      "resourceProfiles",
    );
  });

  test("extracts envelopes from a decoded body, [] otherwise", () => {
    const body: JSONObject = {
      resourceMetrics: [resourceEnvelope([fleetAttribute("f1")])],
    } as JSONObject;

    expect(
      getResourceEnvelopesFromOtelBody(body, ProductType.Metrics),
    ).toHaveLength(1);
    expect(getResourceEnvelopesFromOtelBody(body, ProductType.Traces)).toEqual(
      [],
    );
    expect(getResourceEnvelopesFromOtelBody(null, ProductType.Logs)).toEqual(
      [],
    );
    expect(
      getResourceEnvelopesFromOtelBody(
        { resourceLogs: "not-an-array" } as JSONObject,
        ProductType.Logs,
      ),
    ).toEqual([]);
  });

  test("security: violation messages never echo anything key-shaped", () => {
    /*
     * The messages are built exclusively from fleet names + allowed
     * scope — assert the known shapes stay free of token-ish content.
     */
    const violation: IotFleetScopeViolation | null = findIotFleetScopeViolation(
      {
        allowedIotFleetNames: ["fleet-a"],
        resourceEnvelopes: [resourceEnvelope([fleetAttribute("fleet-b")])],
      },
    );

    expect(violation).not.toBeNull();
    expect(violation!.message).not.toContain("secret");
    expect(violation!.message).not.toContain("token");
    expect(violation!.message).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
  });
});
