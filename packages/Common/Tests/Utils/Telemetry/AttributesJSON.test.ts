import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import {
  ATTRIBUTES_JSON_FORMATS,
  CIRCULAR_REFERENCE_PLACEHOLDER,
  countAttributes,
  previewAttributesJSON,
  stringifyAttributesJSON,
  toAttributesJSON,
  toFlatAttributesJSON,
  toNestedAttributesJSON,
} from "../../../Utils/Telemetry/AttributesJSON";

/*
 * What "Copy JSON" puts on the clipboard for a span's, a log's or an
 * exception's attributes. The text is pasted into tickets, fixtures and jq,
 * so it has to be exactly the recorded data - same keys, same value types -
 * in either the flat (as recorded) or nested (dots expanded) shape.
 */

// Round-trip through text, the way a paste would see it.
function parse(text: string): unknown {
  return JSON.parse(text);
}

function roundTrip(value: JSONObject): unknown {
  return JSON.parse(JSON.stringify(value));
}

const HTTP_SPAN_ATTRIBUTES: Record<string, unknown> = {
  "http.request.method": "GET",
  "http.response.status_code": 200,
  "http.route": "/api/orders/:id",
  "server.address": "shop.example.com",
  "server.port": 443,
  "error.handled": false,
  "enduser.roles": ["admin", "billing"],
  "retry.count": 0,
  "sampling.ratio": 0.25,
};

describe("toFlatAttributesJSON", () => {
  test("keeps every value's type instead of stringifying it", () => {
    const flat: unknown = roundTrip(toFlatAttributesJSON(HTTP_SPAN_ATTRIBUTES));

    expect(flat).toEqual({
      "enduser.roles": ["admin", "billing"],
      "error.handled": false,
      "http.request.method": "GET",
      "http.response.status_code": 200,
      "http.route": "/api/orders/:id",
      "retry.count": 0,
      "sampling.ratio": 0.25,
      "server.address": "shop.example.com",
      "server.port": 443,
    });
  });

  test("sorts keys so the copy matches the order of the attribute list", () => {
    const flat: JSONObject = toFlatAttributesJSON({
      zeta: 1,
      alpha: 2,
      "http.url": "x",
      "http.method": "GET",
      mid: 3,
    });

    expect(Object.keys(flat)).toEqual([
      "alpha",
      "http.method",
      "http.url",
      "mid",
      "zeta",
    ]);
  });

  test("flattens attributes a sender stored nested into dotted keys", () => {
    const flat: unknown = roundTrip(
      toFlatAttributesJSON({
        http: { request: { method: "POST" }, response: { status_code: 201 } },
        "service.name": "checkout",
      }),
    );

    expect(flat).toEqual({
      "http.request.method": "POST",
      "http.response.status_code": 201,
      "service.name": "checkout",
    });
  });

  test("keeps an empty object and arrays of objects as values, not paths", () => {
    const flat: unknown = roundTrip(
      toFlatAttributesJSON({
        "request.headers": {},
        "db.batch": [{ statement: "SELECT 1" }, { statement: "SELECT 2" }],
      }),
    );

    expect(flat).toEqual({
      "db.batch": [{ statement: "SELECT 1" }, { statement: "SELECT 2" }],
      "request.headers": {},
    });
  });

  test("keeps an explicit null, which is a recorded value", () => {
    expect(roundTrip(toFlatAttributesJSON({ "user.id": null }))).toEqual({
      "user.id": null,
    });
  });

  test("drops what JSON cannot carry: undefined, functions and symbols", () => {
    const flat: JSONObject = toFlatAttributesJSON({
      kept: "yes",
      missing: undefined,
      callback: (): void => {},
      marker: Symbol("marker"),
    });

    expect(Object.keys(flat)).toEqual(["kept"]);
  });

  test("keeps NaN and Infinity as text rather than the null JSON.stringify would write", () => {
    expect(
      roundTrip(
        toFlatAttributesJSON({
          "a.nan": NaN,
          "b.infinity": Infinity,
          "c.negative": -Infinity,
        }),
      ),
    ).toEqual({
      "a.nan": "NaN",
      "b.infinity": "Infinity",
      "c.negative": "-Infinity",
    });
  });

  test("writes a bigint as its exact digits instead of throwing", () => {
    const text: string = stringifyAttributesJSON(
      { "messaging.kafka.offset": BigInt("9007199254740993") },
      "flat",
    );

    expect(parse(text)).toEqual({
      "messaging.kafka.offset": "9007199254740993",
    });
  });

  test("writes a Date as ISO-8601 text", () => {
    expect(
      roundTrip(
        toFlatAttributesJSON({
          "job.scheduled_at": new Date("2026-09-23T10:15:30.000Z"),
          "job.bad_date": new Date("not a date"),
        }),
      ),
    ).toEqual({
      "job.bad_date": "Invalid Date",
      "job.scheduled_at": "2026-09-23T10:15:30.000Z",
    });
  });

  test("replaces a circular reference instead of recursing forever", () => {
    const loop: Record<string, unknown> = { name: "loop" };
    loop["self"] = loop;

    const list: Array<unknown> = ["first"];
    list.push(list);

    const flat: unknown = roundTrip(
      toFlatAttributesJSON({ loop, list, "plain.value": 1 }),
    );

    expect(flat).toEqual({
      list: ["first", CIRCULAR_REFERENCE_PLACEHOLDER],
      "loop.name": "loop",
      "loop.self": CIRCULAR_REFERENCE_PLACEHOLDER,
      "plain.value": 1,
    });
  });

  test("keeps the first of two spellings of the same flat key", () => {
    const flat: unknown = roundTrip(
      toFlatAttributesJSON({ "a.b": "dotted", a: { b: "nested" } }),
    );

    expect(flat).toEqual({ "a.b": "dotted" });
  });

  test("returns an empty object for anything that is not an attribute map", () => {
    for (const input of [null, undefined, "text", 42, true, ["a", "b"]]) {
      expect(Object.keys(toFlatAttributesJSON(input))).toEqual([]);
    }
  });

  test("ignores inherited properties", () => {
    const attributes: Record<string, unknown> = Object.create({
      "inherited.secret": "must-not-copy",
    }) as Record<string, unknown>;
    attributes["owned.value"] = "visible";

    expect(roundTrip(toFlatAttributesJSON(attributes))).toEqual({
      "owned.value": "visible",
    });
  });

  test("copies reserved keys as plain data without polluting Object.prototype", () => {
    const attributes: Record<string, unknown> = JSON.parse(
      '{"__proto__":{"polluted":"yes"},"constructor.prototype.polluted":"yes","safe":"ok"}',
    ) as Record<string, unknown>;

    const flat: JSONObject = toFlatAttributesJSON(attributes);
    const nested: JSONObject = toNestedAttributesJSON(attributes);

    expect(Object.keys(flat)).toEqual([
      "__proto__.polluted",
      "constructor.prototype.polluted",
      "safe",
    ]);
    expect(Object.getPrototypeOf(flat)).toBeNull();
    expect(Object.getPrototypeOf(nested)).toBeNull();
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(
      (Object.prototype as unknown as Record<string, unknown>)["polluted"],
    ).toBeUndefined();

    // The pasted text is still the data that was recorded.
    expect(
      stringifyAttributesJSON(attributes, "nested", { indent: 0 }),
    ).toContain('"__proto__":{"polluted":"yes"}');
  });

  test("does not modify the attributes it was given", () => {
    const attributes: Record<string, unknown> = {
      http: { method: "GET" },
      "enduser.roles": ["admin"],
    };
    const snapshot: string = JSON.stringify(attributes);

    toFlatAttributesJSON(attributes);
    toNestedAttributesJSON(attributes);

    expect(JSON.stringify(attributes)).toBe(snapshot);
  });
});

describe("toNestedAttributesJSON", () => {
  test("expands dotted keys into objects", () => {
    expect(roundTrip(toNestedAttributesJSON(HTTP_SPAN_ATTRIBUTES))).toEqual({
      enduser: { roles: ["admin", "billing"] },
      error: { handled: false },
      http: {
        request: { method: "GET" },
        response: { status_code: 200 },
        route: "/api/orders/:id",
      },
      retry: { count: 0 },
      sampling: { ratio: 0.25 },
      server: { address: "shop.example.com", port: 443 },
    });
  });

  test("keeps both halves of a clashing path (db.system and db.system.name)", () => {
    expect(
      roundTrip(
        toNestedAttributesJSON({
          "db.system": "postgresql",
          "db.system.name": "postgresql",
          "db.namespace": "orders",
        }),
      ),
    ).toEqual({
      db: {
        namespace: "orders",
        system: "postgresql",
        "system.name": "postgresql",
      },
    });
  });

  test("keeps the rest of the path together when a value sits at the root", () => {
    expect(
      roundTrip(
        toNestedAttributesJSON({
          http: "legacy",
          "http.method": "GET",
          "http.url.full": "https://example.com",
        }),
      ),
    ).toEqual({
      http: "legacy",
      "http.method": "GET",
      "http.url.full": "https://example.com",
    });
  });

  test("never merges into an empty object that is itself a value", () => {
    expect(
      roundTrip(
        toNestedAttributesJSON({
          "request.headers": {},
          "request.headers.accept": "application/json",
        }),
      ),
    ).toEqual({
      request: {
        headers: {},
        "headers.accept": "application/json",
      },
    });
  });

  test("keeps keys with empty segments verbatim", () => {
    expect(
      roundTrip(
        toNestedAttributesJSON({
          ".leading": 1,
          "trailing.": 2,
          "double..dot": 3,
          "": 4,
          "normal.key": 5,
        }),
      ),
    ).toEqual({
      "": 4,
      ".leading": 1,
      "double..dot": 3,
      normal: { key: 5 },
      "trailing.": 2,
    });
  });

  test("is the flat copy with its dots expanded, so both describe the same data", () => {
    const attributes: Record<string, unknown> = {
      "k8s.pod.name": "api-7d9",
      "k8s.namespace.name": "prod",
      "k8s.pod.uid": "7f1e",
      "process.pid": 4242,
      "process.runtime.name": "node",
    };

    const nested: unknown = roundTrip(toNestedAttributesJSON(attributes));
    const reflattened: unknown = roundTrip(toFlatAttributesJSON(nested));

    expect(reflattened).toEqual(roundTrip(toFlatAttributesJSON(attributes)));
  });

  test("sorts keys at every level", () => {
    const nested: JSONObject = toNestedAttributesJSON({
      "b.z": 1,
      "b.a": 2,
      "a.y": 3,
    });

    expect(Object.keys(nested)).toEqual(["a", "b"]);
    expect(Object.keys(nested["b"] as JSONObject)).toEqual(["a", "z"]);
  });
});

describe("stringifyAttributesJSON", () => {
  test("pretty-prints with two spaces by default", () => {
    expect(
      stringifyAttributesJSON({ "service.name": "api", port: 8080 }, "flat"),
    ).toBe('{\n  "port": 8080,\n  "service.name": "api"\n}');
  });

  test("writes one line when asked for no indent", () => {
    expect(
      stringifyAttributesJSON({ "service.name": "api" }, "nested", {
        indent: 0,
      }),
    ).toBe('{"service":{"name":"api"}}');
  });

  test("treats a negative indent as none", () => {
    expect(stringifyAttributesJSON({ a: 1 }, "flat", { indent: -4 })).toBe(
      '{"a":1}',
    );
  });

  test("produces valid JSON that parses back to the same data", () => {
    for (const format of ATTRIBUTES_JSON_FORMATS) {
      const text: string = stringifyAttributesJSON(
        HTTP_SPAN_ATTRIBUTES,
        format,
      );

      expect(parse(text)).toEqual(
        roundTrip(toAttributesJSON(HTTP_SPAN_ATTRIBUTES, format)),
      );
    }
  });

  test("escapes quotes, backslashes and newlines inside values", () => {
    const text: string = stringifyAttributesJSON(
      {
        "exception.message": 'Unexpected token "}" in JSON',
        "exception.stacktrace":
          "Error: boom\n    at handler (C:\\app\\index.js:1:1)",
      },
      "flat",
    );

    expect(parse(text)).toEqual({
      "exception.message": 'Unexpected token "}" in JSON',
      "exception.stacktrace":
        "Error: boom\n    at handler (C:\\app\\index.js:1:1)",
    });
    // Every line of the pretty text stands alone: no raw newline in a value.
    expect(text.split("\n")).toHaveLength(4);
  });

  test("is an empty object for no attributes", () => {
    expect(stringifyAttributesJSON(undefined, "flat")).toBe("{}");
    expect(stringifyAttributesJSON({}, "nested")).toBe("{}");
  });
});

describe("countAttributes", () => {
  test("counts flat keys, so nested input counts its leaves", () => {
    expect(countAttributes(HTTP_SPAN_ATTRIBUTES)).toBe(9);
    expect(countAttributes({ http: { method: "GET", url: "/" } })).toBe(2);
    expect(countAttributes({ skipped: undefined })).toBe(0);
    expect(countAttributes(null)).toBe(0);
  });
});

describe("previewAttributesJSON", () => {
  test("shows the first attribute in each shape, with an ellipsis when there are more", () => {
    const attributes: Record<string, unknown> = {
      "http.request.method": "GET",
      "http.response.status_code": 200,
    };

    expect(previewAttributesJSON(attributes, "flat")).toBe(
      '{"http.request.method":"GET", …}',
    );
    expect(previewAttributesJSON(attributes, "nested")).toBe(
      '{"http":{"request":{"method":"GET"}}, …}',
    );
  });

  test("has no ellipsis for a single attribute", () => {
    expect(previewAttributesJSON({ "service.name": "api" }, "flat")).toBe(
      '{"service.name":"api"}',
    );
  });

  test("is empty when there is nothing to copy", () => {
    expect(previewAttributesJSON({}, "flat")).toBe("");
    expect(previewAttributesJSON(null, "nested")).toBe("");
  });
});
