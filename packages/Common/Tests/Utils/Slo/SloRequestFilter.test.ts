import { describe, expect, test } from "@jest/globals";
import { SearchValueOperator } from "../../../Types/Telemetry/TelemetrySearchQuery";
import {
  getSloRequestFilterError,
  normalizeSloRequestFilter,
  ParsedSloRequestFilter,
  parseSloRequestFilter,
  SLO_REQUEST_FILTER_ERRORS,
  SLO_REQUEST_FILTER_MAX_LENGTH,
  SLO_REQUEST_FILTER_MAX_TERMS,
  SLO_REQUEST_FILTER_NAME_FIELD,
  SloRequestFilterTerm,
} from "../../../Utils/Slo/SloRequestFilter";

/*
 * A request SLO's request filter (#8444): a traces search of span
 * attributes and the span's name, in the Traces explorer's own grammar, so
 * every term means here what it means there. These pin how a filter is
 * read: what each term becomes, that free text is refused with what to
 * write instead, and the limits.
 */

function termsOf(raw: string): Array<SloRequestFilterTerm> {
  const parsed: ParsedSloRequestFilter = parseSloRequestFilter(raw);

  expect(parsed.error).toBeNull();

  return parsed.terms;
}

describe("normalizeSloRequestFilter", () => {
  test.each([undefined, null, "", "   ", "\n\t"])(
    "an empty filter (%p) is no filter",
    (raw: string | undefined | null) => {
      expect(normalizeSloRequestFilter(raw)).toBeNull();
    },
  );

  test("keeps a filter as written, trimmed", () => {
    expect(normalizeSloRequestFilter("  @http.route:/checkout*  ")).toBe(
      "@http.route:/checkout*",
    );
  });

  test("anything but text is no filter", () => {
    expect(normalizeSloRequestFilter(42 as unknown as string)).toBeNull();
  });
});

describe("parseSloRequestFilter", () => {
  test("no filter has no terms and no error", () => {
    expect(parseSloRequestFilter("")).toEqual({ terms: [], error: null });
    expect(parseSloRequestFilter(null)).toEqual({ terms: [], error: null });
  });

  test("an attribute with a glob", () => {
    const terms: Array<SloRequestFilterTerm> = termsOf(
      "@http.route:/checkout*",
    );

    expect(terms).toHaveLength(1);
    expect(terms[0]).toMatchObject({
      key: "http.route",
      isAttribute: true,
      predicate: {
        operator: SearchValueOperator.Wildcard,
        value: "/checkout*",
      },
    });
  });

  test("a leading - leaves those requests out: the predicate is already turned around", () => {
    const [term] = termsOf("-@http.route:/health") as [SloRequestFilterTerm];

    expect(term.key).toBe("http.route");
    expect(term.predicate.operator).toBe(SearchValueOperator.NotEquals);
    expect(term.predicate.value).toBe("/health");
  });

  test("a bare key:value is an attribute, as the search syntax reads an unknown field", () => {
    const [term] = termsOf("http.request.method:POST") as [
      SloRequestFilterTerm,
    ];

    expect(term).toMatchObject({
      key: "http.request.method",
      isAttribute: true,
    });
    expect(term.predicate).toMatchObject({
      operator: SearchValueOperator.Equals,
      value: "POST",
    });
  });

  test("name: is the span's name - its operation - in any case", () => {
    for (const raw of ['name:"POST /checkout"', 'NAME:"POST /checkout"']) {
      const [term] = termsOf(raw) as [SloRequestFilterTerm];

      expect(term).toMatchObject({
        key: SLO_REQUEST_FILTER_NAME_FIELD,
        isAttribute: false,
      });
      expect(term.predicate.value).toBe("POST /checkout");
    }
  });

  test("@name: is an attribute named name, not the span's name", () => {
    expect(termsOf("@name:checkout")[0]).toMatchObject({
      key: "name",
      isAttribute: true,
    });
  });

  test("a list and a comparison read as the explorer reads them", () => {
    const terms: Array<SloRequestFilterTerm> = termsOf(
      "@http.request.method:[POST, PUT] @http.response.status_code:>=200",
    );

    expect(
      terms.map((term: SloRequestFilterTerm) => {
        return term.predicate.operator;
      }),
    ).toEqual([SearchValueOperator.In, SearchValueOperator.GreaterThanOrEqual]);
    expect(terms[0]!.predicate.values).toEqual(["POST", "PUT"]);
    expect(terms[1]!.predicate.value).toBe("200");
  });

  test("every term is kept, in order, two on one attribute included", () => {
    expect(
      termsOf("@http.route:/checkout* -@http.route:/checkout/health").map(
        (term: SloRequestFilterTerm): string => {
          return `${term.key} ${term.predicate.operator}`;
        },
      ),
    ).toEqual(["http.route Wildcard", "http.route NotEquals"]);
  });

  test("free text is refused, naming the term", () => {
    expect(parseSloRequestFilter("@http.route:/checkout* checkout")).toEqual({
      terms: [],
      error: {
        template: SLO_REQUEST_FILTER_ERRORS.freeText,
        values: { text: "checkout" },
      },
    });
  });

  test.each([
    ["status:error", "status:error"],
    ["STATUS:error", "STATUS:error"],
    // The search syntax glues a known field to a value after a space.
    ["status: error", "status:error"],
    ["service:checkout-api", "service:checkout-api"],
    ["duration:>500", "duration:>500"],
    ["kind:server", "kind:server"],
    [
      "trace:4bf92f3577b34da6a3ce929d0e0e4736",
      "trace:4bf92f3577b34da6a3ce929d0e0e4736",
    ],
    ["span:00f067aa0ba902b7", "span:00f067aa0ba902b7"],
    ["hasException:true", "hasException:true"],
    ["statusMessage:timeout", "statusMessage:timeout"],
  ])(
    "the explorer's own %s is what the SLO already decides, and refused, quoting %s",
    (raw: string, quoted: string) => {
      expect(parseSloRequestFilter(`@http.route:/checkout* ${raw}`)).toEqual({
        terms: [],
        error: {
          template: SLO_REQUEST_FILTER_ERRORS.freeText,
          values: { text: quoted },
        },
      });
    },
  );

  test("an attribute that shares a field's name is written with @", () => {
    expect(termsOf("@status:error @service.version:2.4.1")).toEqual([
      expect.objectContaining({ key: "status", isAttribute: true }),
      expect.objectContaining({ key: "service.version", isAttribute: true }),
    ]);
  });

  test("a leading - leaves out a span name as well", () => {
    const [term] = termsOf('-name:"GET /health"') as [SloRequestFilterTerm];

    expect(term).toMatchObject({
      key: SLO_REQUEST_FILTER_NAME_FIELD,
      isAttribute: false,
    });
    expect(term.predicate.operator).toBe(SearchValueOperator.NotEquals);
    expect(term.predicate.value).toBe("GET /health");
  });

  test("a quoted key:value is free text, and refused", () => {
    expect(
      parseSloRequestFilter('"http.route:/checkout"').error?.template,
    ).toBe(SLO_REQUEST_FILTER_ERRORS.freeText);
  });

  test(`at most ${SLO_REQUEST_FILTER_MAX_LENGTH} characters`, () => {
    const atTheLimit: string = `@k:${"a".repeat(SLO_REQUEST_FILTER_MAX_LENGTH - 3)}`;

    expect(parseSloRequestFilter(atTheLimit).error).toBeNull();
    expect(parseSloRequestFilter(`${atTheLimit}a`).error).toEqual({
      template: SLO_REQUEST_FILTER_ERRORS.tooLong,
      values: { max: SLO_REQUEST_FILTER_MAX_LENGTH },
    });
  });

  test(`at most ${SLO_REQUEST_FILTER_MAX_TERMS} terms`, () => {
    const terms: Array<string> = [];

    for (let index: number = 0; index < SLO_REQUEST_FILTER_MAX_TERMS; index++) {
      terms.push(`@k${index}:v`);
    }

    expect(parseSloRequestFilter(terms.join(" ")).terms).toHaveLength(
      SLO_REQUEST_FILTER_MAX_TERMS,
    );
    expect(
      parseSloRequestFilter([...terms, "@extra:v"].join(" ")).error,
    ).toEqual({
      template: SLO_REQUEST_FILTER_ERRORS.tooManyTerms,
      values: { max: SLO_REQUEST_FILTER_MAX_TERMS },
    });
  });
});

describe("getSloRequestFilterError", () => {
  test("a filter OneUptime can count with has no error", () => {
    expect(getSloRequestFilterError("")).toBeNull();
    expect(
      getSloRequestFilterError("@http.route:/checkout* -@http.route:/health"),
    ).toBeNull();
  });

  test("says what is wrong in English, as the API answers it", () => {
    expect(getSloRequestFilterError("checkout")).toBe(
      'The request filter takes span attributes and the span\'s name, such as @http.route:/checkout* or name:"POST /checkout". "checkout" is neither.',
    );
    expect(
      getSloRequestFilterError("x".repeat(SLO_REQUEST_FILTER_MAX_LENGTH + 1)),
    ).toBe("The request filter can be at most 500 characters long.");
  });
});
