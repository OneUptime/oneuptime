import PinServiceName from "../../../../Server/Utils/Telemetry/PinServiceName";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * PinServiceName is the control that stops telemetry written with a scraped
 * Browser ingestion key from masquerading as a backend service.
 *
 * A Browser key is published in page source by design, so it must be assumed
 * scraped. The origin allowlist and the rate limit bound HOW MUCH forged data
 * an attacker can write and FROM WHERE; neither stops them writing it under
 * `service.name: "payments-api"` and poisoning the dashboards, SLOs, telemetry
 * monitors and alert rules of a service that never emitted a byte of it.
 * Pinning is what makes forged data self-identifying, so it has to hold on
 * every payload an attacker can compose - not just the well-formed ones.
 *
 * Three properties are pinned here, and each maps to a concrete bypass:
 *
 *   1. TOTALITY. Every resource block under resourceSpans / resourceLogs /
 *      resourceMetrics / resourceProfiles is rewritten. One unwalked
 *      container, or one skipped block in a batch of a thousand, is a forged
 *      span filed under someone else's service.
 *   2. EXACTLY ONE service.name survives, and it is ours. Replacement - not
 *      appending - is the whole game: a forger who sends several service.name
 *      attributes hoping a downstream consumer takes the first (or the one
 *      with a non-string OTLP value, or the oddly-cased one) must end up with
 *      a payload where there is nothing left to take but the pin.
 *   3. IT NEVER THROWS, AND IT NEVER SKIPS ON MALFORMED INPUT. This runs in a
 *      queue worker on JSON that has not been schema-validated yet. A
 *      TypeError would fail the whole batch and would be reachable by anyone
 *      holding a scraped key; a `"resource": "not-an-object"` that merely got
 *      skipped would be a one-character bypass of the entire control. So a
 *      hostile shape is repaired where there is somewhere to write, and only
 *      ever skipped where there is not.
 *
 * The suite therefore leans hard on attacker-shaped input: nulls, primitives
 * and arrays in every position a spec-shaped payload has an object.
 */

const PINNED: string = "browser-frontend";

/*
 * pinInPlace's signature is typed for well-formed OTLP; every hostile case
 * below has to go in through `unknown` to be expressible at all, so funnel
 * every call through one helper rather than scattering casts.
 */
const pinRaw: (body: unknown, serviceName: unknown) => number = (
  body: unknown,
  serviceName: unknown,
): number => {
  return PinServiceName.pinInPlace(body as JSONObject, serviceName as string);
};

/*
 * Note the two entry points: `pin` defaults the name, so it cannot be used to
 * test an explicitly-undefined name (the default would swallow it) - those
 * cases go through pinRaw and reach pinInPlace with the argument as written.
 */
const pin: (body: unknown, serviceName?: unknown) => number = (
  body: unknown,
  serviceName: unknown = PINNED,
): number => {
  return pinRaw(body, serviceName);
};

const attributesOf: (block: unknown) => Array<JSONObject> = (
  block: unknown,
): Array<JSONObject> => {
  const resource: JSONObject = (block as JSONObject)["resource"] as JSONObject;
  return resource["attributes"] as unknown as Array<JSONObject>;
};

const serviceNameAttributesOf: (block: unknown) => Array<JSONObject> = (
  block: unknown,
): Array<JSONObject> => {
  return attributesOf(block).filter((attribute: JSONObject): boolean => {
    return (
      typeof attribute === "object" &&
      attribute !== null &&
      !Array.isArray(attribute) &&
      String(attribute["key"] ?? "")
        .trim()
        .toLowerCase() === "service.name"
    );
  });
};

const pinnedAttribute: (serviceName?: string) => JSONObject = (
  serviceName: string = PINNED,
): JSONObject => {
  return {
    key: "service.name",
    value: {
      stringValue: serviceName,
    },
  };
};

const blockWithAttributes: (attributes: unknown) => JSONObject = (
  attributes: unknown,
): JSONObject => {
  return {
    resource: {
      attributes: attributes as JSONValue,
    },
  };
};

const clone: (value: unknown) => unknown = (value: unknown): unknown => {
  return JSON.parse(JSON.stringify(value)) as unknown;
};

/*
 * All four OTLP resource containers. Profiles are in the list even though a
 * Browser key cannot reach the profiles surface: a SERVER key may carry a pin
 * too, and the pin has to mean the same thing for every signal.
 */
const CONTAINER_KEYS: Array<string> = [
  "resourceSpans",
  "resourceLogs",
  "resourceMetrics",
  "resourceProfiles",
];

describe("PinServiceName.pinInPlace: coverage of every OTLP resource container", () => {
  test.each(CONTAINER_KEYS)(
    "pins every resource block under %s and returns the number rewritten",
    (containerKey: string) => {
      const body: JSONObject = {
        [containerKey]: [
          blockWithAttributes([]),
          blockWithAttributes([pinnedAttribute("forged-backend")]),
        ],
      };

      const rewritten: number = pin(body);

      expect(rewritten).toBe(2);

      const blocks: Array<JSONObject> = body[
        containerKey
      ] as unknown as Array<JSONObject>;

      for (const block of blocks) {
        expect(serviceNameAttributesOf(block)).toEqual([pinnedAttribute()]);
      }
    },
  );

  test("a payload carrying all four signals has all four pinned and counts every block", () => {
    const body: JSONObject = {
      resourceSpans: [blockWithAttributes([]), blockWithAttributes([])],
      resourceLogs: [blockWithAttributes([])],
      resourceMetrics: [
        blockWithAttributes([pinnedAttribute("payments-api")]),
        blockWithAttributes([]),
        blockWithAttributes([]),
      ],
      resourceProfiles: [blockWithAttributes([pinnedAttribute("profiler")])],
    };

    expect(pin(body)).toBe(7);

    for (const containerKey of CONTAINER_KEYS) {
      const blocks: Array<JSONObject> = body[
        containerKey
      ] as unknown as Array<JSONObject>;

      for (const block of blocks) {
        expect(serviceNameAttributesOf(block)).toEqual([pinnedAttribute()]);
      }
    }
  });

  test("an empty container contributes nothing to the count but is not an error", () => {
    const body: JSONObject = {
      resourceSpans: [],
      resourceLogs: [blockWithAttributes([])],
    };

    expect(pin(body)).toBe(1);
  });

  test("rewrites the caller's body in place rather than returning a copy", () => {
    const resource: JSONObject = { attributes: [] };
    const container: Array<JSONObject> = [{ resource: resource }];
    const body: JSONObject = {
      resourceSpans: container as unknown as JSONValue,
    };

    pin(body);

    // The caller keeps its own references; nothing is deep-cloned on the hot path.
    expect(body["resourceSpans"]).toBe(container);
    expect((container[0] as JSONObject)["resource"]).toBe(resource);
    expect(resource["attributes"]).toEqual([pinnedAttribute()]);
  });
});

describe("PinServiceName.pinInPlace: exactly one service.name survives", () => {
  test("an existing service.name is replaced, not duplicated", () => {
    const block: JSONObject = blockWithAttributes([
      pinnedAttribute("payments-api"),
    ]);

    expect(pin({ resourceSpans: [block] })).toBe(1);

    expect(attributesOf(block)).toEqual([pinnedAttribute()]);
  });

  test("several forged service.name entries all collapse to exactly one pinned entry", () => {
    const block: JSONObject = blockWithAttributes([
      pinnedAttribute("payments-api"),
      { key: "http.method", value: { stringValue: "GET" } },
      pinnedAttribute("auth-service"),
      pinnedAttribute("billing-worker"),
    ]);

    pin({ resourceLogs: [block] });

    expect(serviceNameAttributesOf(block)).toHaveLength(1);
    expect(attributesOf(block)).toEqual([
      { key: "http.method", value: { stringValue: "GET" } },
      pinnedAttribute(),
    ]);
  });

  test("a service.name that differs only by case or padding is still removed", () => {
    /*
     * Deliberately looser than the OTLP spec, which is case-sensitive: the
     * cost of over-matching is that an exotic key is dropped, and the cost of
     * under-matching is a bypass through any consumer that folds case.
     */
    const block: JSONObject = blockWithAttributes([
      { key: "Service.Name", value: { stringValue: "payments-api" } },
      { key: "  service.name  ", value: { stringValue: "auth-service" } },
      { key: "SERVICE.NAME", value: { stringValue: "billing-worker" } },
    ]);

    pin({ resourceMetrics: [block] });

    expect(attributesOf(block)).toEqual([pinnedAttribute()]);
  });

  test("a service.name attribute carrying a non-string OTLP value is still replaced by a stringValue", () => {
    const forgedValues: Array<JSONObject> = [
      { key: "service.name", value: { intValue: "42" } },
      { key: "service.name", value: { boolValue: true } },
      {
        key: "service.name",
        value: {
          arrayValue: { values: [{ stringValue: "payments-api" }] },
        },
      },
      { key: "service.name", value: null },
      { key: "service.name" },
      { key: "service.name", value: { kvlistValue: { values: [] } } },
      { key: "service.name", value: "payments-api" },
      { key: "service.name", value: ["payments-api"] },
    ];

    for (const forged of forgedValues) {
      const block: JSONObject = blockWithAttributes([forged]);

      expect(pin({ resourceSpans: [block] })).toBe(1);

      expect(attributesOf(block)).toEqual([pinnedAttribute()]);
    }
  });

  test("service.name is appended when the resource never carried one", () => {
    const block: JSONObject = blockWithAttributes([
      { key: "host.name", value: { stringValue: "laptop" } },
    ]);

    pin({ resourceSpans: [block] });

    expect(attributesOf(block)).toEqual([
      { key: "host.name", value: { stringValue: "laptop" } },
      pinnedAttribute(),
    ]);
  });

  test("unrelated attributes keep their identity and relative order, and the pin lands last", () => {
    const first: JSONObject = {
      key: "telemetry.sdk.name",
      value: { stringValue: "opentelemetry" },
    };
    const second: JSONObject = {
      key: "deployment.environment",
      value: { stringValue: "production" },
    };
    const third: JSONObject = {
      key: "host.arch",
      value: { stringValue: "arm64" },
    };

    const block: JSONObject = blockWithAttributes([
      first,
      pinnedAttribute("payments-api"),
      second,
      third,
    ]);

    pin({ resourceLogs: [block] });

    const attributes: Array<JSONObject> = attributesOf(block);

    expect(attributes).toHaveLength(4);
    // Same objects, same order - nothing is rebuilt or reordered.
    expect(attributes[0]).toBe(first);
    expect(attributes[1]).toBe(second);
    expect(attributes[2]).toBe(third);
    expect(attributes[3]).toEqual(pinnedAttribute());
  });
});

describe("PinServiceName.pinInPlace: missing or malformed structure is repaired, never skipped", () => {
  test("a resource block with no resource at all gets one created and pinned", () => {
    const block: JSONObject = { scopeSpans: [] };

    expect(pin({ resourceSpans: [block] })).toBe(1);

    expect(block["resource"]).toEqual({ attributes: [pinnedAttribute()] });
    // The rest of the envelope is untouched.
    expect(block["scopeSpans"]).toEqual([]);
  });

  test("a resource with no attributes array gets one created and pinned", () => {
    const resource: JSONObject = { droppedAttributesCount: 0 };
    const block: JSONObject = { resource: resource };

    expect(pin({ resourceLogs: [block] })).toBe(1);

    expect(resource["attributes"]).toEqual([pinnedAttribute()]);
    expect(resource["droppedAttributesCount"]).toBe(0);
  });

  test.each([
    ["an object", { "service.name": "payments-api" } as unknown],
    ["a string", "service.name=payments-api" as unknown],
    ["a number", 7 as unknown],
    ["null", null as unknown],
    ["a boolean", true as unknown],
  ])(
    "attributes that are %s are replaced with a valid array holding only the pin",
    (_label: string, attributes: unknown) => {
      const block: JSONObject = blockWithAttributes(attributes);

      expect(pin({ resourceMetrics: [block] })).toBe(1);

      /*
       * The malformed value is discarded rather than preserved. That is the
       * safe direction: leaving it in place would let a forged payload keep an
       * unpinned service.name under a shape the walker cannot read.
       */
      expect(attributesOf(block)).toEqual([pinnedAttribute()]);
    },
  );

  test.each([
    ["a string", "not-a-resource" as unknown],
    ["a number", 1 as unknown],
    ["an array", [{ attributes: [] }] as unknown],
    ["a boolean", false as unknown],
    ["null", null as unknown],
  ])(
    "a resource that is %s is replaced with a real resource carrying the pin",
    (_label: string, resource: unknown) => {
      const block: JSONObject = { resource: resource as JSONValue };

      expect(pin({ resourceSpans: [block] })).toBe(1);

      expect(block["resource"]).toEqual({ attributes: [pinnedAttribute()] });
    },
  );

  test("attribute entries that are null, primitives or arrays are preserved untouched alongside the pin", () => {
    const block: JSONObject = blockWithAttributes([
      null,
      "not-an-attribute",
      42,
      true,
      ["service.name", "payments-api"],
      { value: { stringValue: "no key at all" } },
      { key: 7, value: { stringValue: "non-string key" } },
      { key: null },
      pinnedAttribute("payments-api"),
    ]);

    expect(pin({ resourceLogs: [block] })).toBe(1);

    expect(attributesOf(block)).toEqual([
      null,
      "not-an-attribute",
      42,
      true,
      ["service.name", "payments-api"],
      { value: { stringValue: "no key at all" } },
      { key: 7, value: { stringValue: "non-string key" } },
      { key: null },
      pinnedAttribute(),
    ]);
  });

  test("blocks that are not objects are skipped, and their well-formed siblings are still pinned", () => {
    const good: JSONObject = blockWithAttributes([]);
    const alsoGood: JSONObject = blockWithAttributes([
      pinnedAttribute("payments-api"),
    ]);

    const body: JSONObject = {
      resourceSpans: [
        null,
        undefined,
        "resource",
        0,
        false,
        [],
        [{ resource: {} }],
        good,
        alsoGood,
      ] as unknown as JSONValue,
    };

    // Only the two real envelopes are rewritable; there is nowhere to write on the rest.
    expect(pin(body)).toBe(2);
    expect(attributesOf(good)).toEqual([pinnedAttribute()]);
    expect(attributesOf(alsoGood)).toEqual([pinnedAttribute()]);
  });
});

describe("PinServiceName.pinInPlace: hostile input never throws", () => {
  const hostileBodies: Array<[string, unknown]> = [
    ["null body", null],
    ["undefined body", undefined],
    ["array body", [{ resourceSpans: [] }]],
    ["string body", "resourceSpans"],
    ["number body", 42],
    ["boolean body", true],
    ["empty body", {}],
    ["resourceSpans is a string", { resourceSpans: "resourceSpans" }],
    ["resourceSpans is a number", { resourceSpans: 1 }],
    ["resourceSpans is null", { resourceSpans: null }],
    ["resourceSpans is undefined", { resourceSpans: undefined }],
    ["resourceSpans is a boolean", { resourceSpans: false }],
    [
      "resourceSpans is an object, not an array",
      { resourceSpans: { "0": { resource: {} } } },
    ],
    ["resourceLogs is a string", { resourceLogs: "x" }],
    ["resourceMetrics is an object", { resourceMetrics: { resource: {} } }],
    ["array of nulls", { resourceSpans: [null, null] }],
    ["array of primitives", { resourceSpans: ["a", 1, true] }],
    ["array of arrays", { resourceSpans: [[], [[]]] }],
    ["resource is a primitive", { resourceSpans: [{ resource: 5 }] }],
    [
      "attributes is a primitive",
      { resourceSpans: [{ resource: { attributes: 5 } }] },
    ],
    [
      "attributes holds hostile entries",
      {
        resourceSpans: [
          { resource: { attributes: [null, 1, [], { key: {} }] } },
        ],
      },
    ],
    [
      "deeply nested but malformed",
      {
        resourceSpans: [
          {
            resource: {
              attributes: [
                {
                  key: "service.name",
                  value: { arrayValue: { values: [{ stringValue: "x" }] } },
                },
              ],
            },
            scopeSpans: [
              { scope: null, spans: "not-an-array" },
              { spans: [{ attributes: { key: "service.name" } }] },
            ],
          },
        ],
        resourceLogs: [{ resource: [], scopeLogs: 3 }],
        resourceMetrics: "none",
      },
    ],
  ];

  test.each(hostileBodies)(
    "returns a number and does not throw on: %s",
    (_label: string, body: unknown) => {
      let result: number = -1;

      expect((): void => {
        result = pin(body);
      }).not.toThrow();

      expect(typeof result).toBe("number");
      expect(Number.isInteger(result)).toBe(true);
      expect(result).toBeGreaterThanOrEqual(0);
    },
  );

  test("a body whose container is not an array is left completely alone", () => {
    const body: JSONObject = {
      resourceSpans: { "0": { resource: { attributes: [] } } },
    };
    const before: unknown = clone(body);

    expect(pin(body)).toBe(0);
    expect(body).toEqual(before);
  });

  test("a large hostile batch is walked to the end without throwing", () => {
    const blocks: Array<unknown> = [];

    for (let index: number = 0; index < 500; index++) {
      blocks.push(index % 2 === 0 ? blockWithAttributes([]) : null);
    }

    expect(pin({ resourceSpans: blocks as unknown as JSONValue })).toBe(250);
  });
});

describe("PinServiceName.pinInPlace: the pinned name itself", () => {
  test.each([
    ["an empty string", ""],
    ["whitespace only", "     "],
  ])(
    "refuses to pin when the name is %s, leaving the payload untouched",
    (_label: string, serviceName: string) => {
      const body: JSONObject = {
        resourceSpans: [blockWithAttributes([pinnedAttribute("payments-api")])],
      };
      const before: unknown = clone(body);

      /*
       * Stamping `service.name: ""` on everything would be strictly worse than
       * not pinning - it destroys the customer's own attribution AND makes the
       * forged data indistinguishable from it.
       */
      expect(pin(body, serviceName)).toBe(0);
      expect(body).toEqual(before);
    },
  );

  test.each([
    ["undefined", undefined as unknown],
    ["null", null as unknown],
    ["a number", 42 as unknown],
    ["an object", { name: "payments-api" } as unknown],
  ])(
    "refuses to pin when the name is %s rather than a string",
    (_label: string, serviceName: unknown) => {
      const body: JSONObject = {
        resourceSpans: [blockWithAttributes([])],
      };
      const before: unknown = clone(body);

      expect(pinRaw(body, serviceName)).toBe(0);
      expect(body).toEqual(before);
    },
  );

  test("surrounding whitespace on the pinned name is trimmed before it is written", () => {
    const block: JSONObject = blockWithAttributes([]);

    expect(pin({ resourceSpans: [block] }, "  browser-frontend  ")).toBe(1);

    expect(attributesOf(block)).toEqual([pinnedAttribute()]);
  });

  test("a very long pinned name is written verbatim rather than truncated or rejected", () => {
    const longName: string = "a".repeat(10000);
    const block: JSONObject = blockWithAttributes([
      pinnedAttribute("payments-api"),
    ]);

    expect(pin({ resourceSpans: [block] }, longName)).toBe(1);

    expect(attributesOf(block)).toEqual([pinnedAttribute(longName)]);
  });

  test("a name full of odd characters is written verbatim, not escaped or dropped", () => {
    const oddName: string = 'svc"\\/<>&   name';
    const block: JSONObject = blockWithAttributes([]);

    expect(pin({ resourceSpans: [block] }, oddName)).toBe(1);

    expect(attributesOf(block)).toEqual([pinnedAttribute(oddName)]);
  });
});

describe("PinServiceName.pinInPlace: every OTLP container, and nothing else", () => {
  test("resourceProfiles is walked like the other three", () => {
    /*
     * A Browser key cannot reach the profiles surface at all
     * (BROWSER_ALLOWED_INGEST_SURFACES), so this is not part of containing a
     * scraped credential. It is here because a SERVER key may carry a pin too,
     * and the dashboard field promises the pin applies to "everything the key
     * writes" - a promise that would be quietly false for one signal if
     * profiles were skipped.
     */
    const body: JSONObject = {
      resourceProfiles: [
        blockWithAttributes([pinnedAttribute("payments-api")]),
      ],
    };

    expect(pin(body)).toBe(1);

    expect(
      attributesOf((body["resourceProfiles"] as Array<JSONObject>)[0]!),
    ).toEqual([pinnedAttribute(PINNED)]);
  });

  test("unrelated top-level keys survive a payload that does get pinned", () => {
    const body: JSONObject = {
      resourceSpans: [blockWithAttributes([])],
      partialSuccess: { rejectedSpans: "0" },
      someVendorExtension: { nested: { deep: [1, 2, 3] } },
    };

    expect(pin(body)).toBe(1);

    expect(body["partialSuccess"]).toEqual({ rejectedSpans: "0" });
    expect(body["someVendorExtension"]).toEqual({
      nested: { deep: [1, 2, 3] },
    });
  });
});

describe("PinServiceName.pinInPlace: idempotence", () => {
  test("pinning an already-pinned payload changes nothing and reports the same count", () => {
    const body: JSONObject = {
      resourceSpans: [
        blockWithAttributes([
          { key: "host.name", value: { stringValue: "laptop" } },
          pinnedAttribute("payments-api"),
        ]),
        { scopeSpans: [] },
      ],
      resourceLogs: [blockWithAttributes("not-an-array")],
      resourceMetrics: [blockWithAttributes([null, pinnedAttribute("x")])],
    };

    const firstCount: number = pin(body);
    const afterFirst: unknown = clone(body);

    const secondCount: number = pin(body);
    const afterSecond: unknown = clone(body);

    expect(firstCount).toBe(4);
    expect(secondCount).toBe(firstCount);
    expect(afterSecond).toEqual(afterFirst);

    // And a third pass is still a fixed point.
    expect(pin(body)).toBe(firstCount);
    expect(clone(body)).toEqual(afterFirst);
  });
});
