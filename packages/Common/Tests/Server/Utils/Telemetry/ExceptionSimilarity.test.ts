import { describe, expect, test } from "@jest/globals";
import {
  exceptionSignature,
  ExceptionSignature,
  ExceptionSignatureInput,
  rankSimilarExceptions,
  RankedSimilar,
  sharedWords,
  similarityReason,
} from "../../../../Server/Utils/Telemetry/ExceptionSimilarity";
import {
  MAX_SIMILAR_EXCEPTIONS,
  SimilarExceptionReason,
} from "../../../../Types/Telemetry/SimilarExceptions";

/*
 * How much one exception looks like another: the same message once the
 * values are out (and the same type), the same function of the
 * application's own code, or most of the same words - the normalizer's
 * placeholders not counted - strongest reason first.
 */

const CART_TRACE: string =
  "TypeError: x\n    at checkout (/app/src/cart.ts:42:17)\n    at run (/app/node_modules/x/index.js:1:1)";
const OTHER_TRACE: string =
  "TypeError: y\n    at pay (/app/src/payments.ts:7:3)\n    at run (/app/node_modules/x/index.js:1:1)";

function input(
  id: string,
  overrides: Partial<ExceptionSignatureInput> = {},
): ExceptionSignatureInput {
  return {
    id,
    exceptionType: "TypeError",
    message: "Cannot read properties of undefined (reading 'items')",
    stackTrace: CART_TRACE,
    ...overrides,
  };
}

function reasonOf(
  a: ExceptionSignatureInput,
  b: ExceptionSignatureInput,
): SimilarExceptionReason | null {
  return similarityReason(exceptionSignature(a), exceptionSignature(b));
}

describe("exceptionSignature", () => {
  test("takes the values out of the message, and finds the function of the application's own code", () => {
    const signature: ExceptionSignature = exceptionSignature(
      input("a", {
        message:
          "Order 4f1c2a9e-5b6d-4c7e-8f90-123456789abc failed for user 42",
      }),
    );

    expect(signature.message).toContain("<uuid>");
    expect(signature.message).not.toContain("4f1c2a9e");
    expect(signature.codeLocation).toBe("/app/src/cart.ts|checkout");
    // Placeholders are not words.
    expect(signature.words.has("uuid")).toBe(false);
    expect(signature.words.has("order")).toBe(true);
    expect(signature.words.has("failed")).toBe(true);
  });

  test("a stack trace with no frame of the application's own code has no code location", () => {
    expect(
      exceptionSignature(
        input("a", {
          stackTrace: "Error\n    at run (/app/node_modules/x/index.js:1:1)",
        }),
      ).codeLocation,
    ).toBe("");
    expect(
      exceptionSignature(input("a", { stackTrace: "" })).codeLocation,
    ).toBe("");
  });
});

describe("similarityReason", () => {
  test("the same type and message, once the values are out", () => {
    expect(
      reasonOf(
        input("a", {
          message: "Order 10012345 failed",
          stackTrace: OTHER_TRACE,
        }),
        input("b", {
          message: "Order 20023456 failed",
          stackTrace: CART_TRACE,
        }),
      ),
    ).toBe(SimilarExceptionReason.SameMessage);
  });

  /*
   * A short number is left in by the fingerprint's normalizer, so the two
   * land in different groups; their words still agree.
   */
  test("a value the normalizer leaves in still reads as a similar message", () => {
    expect(
      reasonOf(
        input("a", {
          message: "Order 1001 failed to reserve stock",
          stackTrace: OTHER_TRACE,
        }),
        input("b", {
          message: "Order 2002 failed to reserve stock",
          stackTrace: CART_TRACE,
        }),
      ),
    ).toBe(SimilarExceptionReason.SimilarMessage);
  });

  test("the same function of the application's own code", () => {
    expect(
      reasonOf(
        input("a", { exceptionType: "TypeError", message: "x is undefined" }),
        input("b", {
          exceptionType: "ReferenceError",
          message: "items is not defined",
        }),
      ),
    ).toBe(SimilarExceptionReason.SameCodeLocation);
  });

  test("most of the same words: less of them for the same type than for another", () => {
    const a: ExceptionSignatureInput = input("a", {
      message: "payment provider timeout while charging the card",
      stackTrace: CART_TRACE,
    });
    const sameType: ExceptionSignatureInput = input("b", {
      message: "payment provider timeout while charging card again",
      stackTrace: OTHER_TRACE,
    });
    const otherType: ExceptionSignatureInput = {
      ...sameType,
      exceptionType: "TimeoutError",
    };

    expect(reasonOf(a, sameType)).toBe(SimilarExceptionReason.SimilarMessage);
    expect(reasonOf(a, otherType)).toBe(null);
  });

  test("nothing in common, or the exception itself, is not similar", () => {
    expect(
      reasonOf(
        input("a", { message: "disk full", stackTrace: OTHER_TRACE }),
        input("b", { message: "socket hang up", stackTrace: CART_TRACE }),
      ),
    ).toBe(null);
    expect(reasonOf(input("a"), input("a"))).toBe(null);
  });
});

describe("sharedWords", () => {
  test("is the share of words both messages have", () => {
    expect(
      sharedWords(
        new Set(["aaa", "bbb", "ccc"]),
        new Set(["aaa", "bbb", "ddd"]),
      ),
    ).toBe(0.5);
    expect(sharedWords(new Set(), new Set(["aaa"]))).toBe(0);
  });
});

describe("rankSimilarExceptions", () => {
  test("the strongest reason first, then in the order given, each once, never the target, at most five", () => {
    const target: ExceptionSignatureInput = input("t", {
      message: "Order 10000001 failed for the cart",
    });
    const candidates: Array<ExceptionSignatureInput> = [
      input("location", { message: "something else entirely" }),
      input("message", { message: "Order 10000002 failed for the cart" }),
      input("message", { message: "Order 10000003 failed for the cart" }),
      input("t"),
      input("unrelated", { message: "disk full", stackTrace: OTHER_TRACE }),
      ...Array.from({ length: 10 }, (_value: unknown, index: number) => {
        return input(`more-${index}`, {
          message: `Order ${20000000 + index} failed for the cart`,
        });
      }),
    ];

    const ranked: Array<RankedSimilar<ExceptionSignatureInput>> =
      rankSimilarExceptions(target, candidates);

    expect(ranked).toHaveLength(MAX_SIMILAR_EXCEPTIONS);
    expect(
      ranked.map((entry: RankedSimilar<ExceptionSignatureInput>) => {
        return [entry.candidate.id, entry.reason];
      }),
    ).toEqual([
      ["message", SimilarExceptionReason.SameMessage],
      ["more-0", SimilarExceptionReason.SameMessage],
      ["more-1", SimilarExceptionReason.SameMessage],
      ["more-2", SimilarExceptionReason.SameMessage],
      ["more-3", SimilarExceptionReason.SameMessage],
    ]);
  });

  test("a megabyte message or stack trace is cut before it is read", () => {
    const huge: string = "x".repeat(4 * 1024 * 1024);
    const ranked: Array<RankedSimilar<ExceptionSignatureInput>> =
      rankSimilarExceptions(input("t", { message: huge, stackTrace: huge }), [
        input("a", { message: huge, stackTrace: huge }),
      ]);

    expect(
      ranked.map((entry: RankedSimilar<ExceptionSignatureInput>) => {
        return entry.reason;
      }),
    ).toEqual([SimilarExceptionReason.SameMessage]);
  });
});
