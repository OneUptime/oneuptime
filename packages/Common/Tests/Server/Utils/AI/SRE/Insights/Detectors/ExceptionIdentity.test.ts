import {
  EXCEPTION_LABEL_MESSAGE_MAX_LENGTH,
  buildExceptionFailureModeKey,
  buildExceptionLabel,
} from "../../../../../../../Server/Utils/AI/SRE/Insights/Detectors/ExceptionIdentity";
import Crypto from "../../../../../../../Utils/Crypto";
import { normalizeExceptionText } from "../../../../../../../Server/Utils/Telemetry/ExceptionSanitizer";
import ObjectID from "../../../../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

describe("ExceptionIdentity", () => {
  describe("buildExceptionLabel", () => {
    test("falls back to a fixed label when both type and message are empty", () => {
      expect(buildExceptionLabel("", "")).toBe("Unknown exception");
      expect(buildExceptionLabel(undefined, undefined)).toBe(
        "Unknown exception",
      );
      // Whitespace-only inputs trim down to empty and hit the same fallback.
      expect(buildExceptionLabel("   ", "  \t ")).toBe("Unknown exception");
    });

    test("uses the type alone when there is no message", () => {
      expect(buildExceptionLabel("TypeError", "")).toBe("TypeError");
      expect(buildExceptionLabel("  TypeError  ", undefined)).toBe("TypeError");
    });

    test("uses the message alone when there is no type", () => {
      expect(buildExceptionLabel("", "connection refused")).toBe(
        "connection refused",
      );
      expect(buildExceptionLabel(undefined, "  connection refused  ")).toBe(
        "connection refused",
      );
    });

    test("combines type and message with a colon separator", () => {
      expect(
        buildExceptionLabel(
          "TypeError",
          "Cannot read properties of undefined (reading 'user')",
        ),
      ).toBe("TypeError: Cannot read properties of undefined (reading 'user')");
    });

    test("does not repeat the type when the message already starts with it", () => {
      // "Error: <message>" — the runtime-prefixed shape.
      expect(buildExceptionLabel("Error", "Error: connect ECONNREFUSED")).toBe(
        "Error: connect ECONNREFUSED",
      );
      // "<Type> <message>" — space-separated prefix.
      expect(
        buildExceptionLabel("ValueError", "ValueError invalid literal"),
      ).toBe("ValueError invalid literal");
      // Message reported verbatim as the type.
      expect(buildExceptionLabel("401", "401")).toBe("401");
    });

    test("treats the type-prefix check case-insensitively", () => {
      expect(buildExceptionLabel("error", "ERROR: boom")).toBe("ERROR: boom");
      expect(buildExceptionLabel("TypeError", "typeerror: boom")).toBe(
        "typeerror: boom",
      );
    });

    test("does not collapse when the type only appears mid-message", () => {
      // "Error" is a substring but not a prefix, so both halves are kept.
      expect(buildExceptionLabel("Error", "Fatal Error happened")).toBe(
        "Error: Fatal Error happened",
      );
    });

    test("truncates a long message and appends an ellipsis", () => {
      const longMessage: string = "x".repeat(
        EXCEPTION_LABEL_MESSAGE_MAX_LENGTH + 50,
      );
      const label: string = buildExceptionLabel("TypeError", longMessage);

      const expectedShort: string =
        "x".repeat(EXCEPTION_LABEL_MESSAGE_MAX_LENGTH) + "…";
      expect(label).toBe(`TypeError: ${expectedShort}`);
      // The ellipsis is a single char, so the message portion is cap + 1.
      expect(label.endsWith("…")).toBe(true);
    });

    test("does not truncate a message exactly at the cap", () => {
      const exact: string = "y".repeat(EXCEPTION_LABEL_MESSAGE_MAX_LENGTH);
      expect(buildExceptionLabel("", exact)).toBe(exact);
      expect(buildExceptionLabel("", exact).endsWith("…")).toBe(false);
    });

    test("honors a custom message max length", () => {
      expect(buildExceptionLabel("E", "abcdefghij", 4)).toBe("E: abcd…");
      expect(buildExceptionLabel("", "abcdefghij", 4)).toBe("abcd…");
    });
  });

  describe("buildExceptionFailureModeKey", () => {
    const entityId: ObjectID = ObjectID.generate();

    test("is deterministic for the same inputs", () => {
      const args: {
        primaryEntityId: ObjectID;
        exceptionType: string;
        message: string;
      } = {
        primaryEntityId: entityId,
        exceptionType: "TypeError",
        message: "Cannot read properties of undefined",
      };

      expect(buildExceptionFailureModeKey(args)).toBe(
        buildExceptionFailureModeKey(args),
      );
    });

    test("keeps the entity id in the clear and hashes the content half", () => {
      const key: string = buildExceptionFailureModeKey({
        primaryEntityId: entityId,
        exceptionType: "TypeError",
        message: "boom",
      });

      const expectedHash: string = Crypto.getSha256Hash(
        `TypeError|${normalizeExceptionText("boom")}`,
      );
      expect(key).toBe(`${entityId.toString()}:${expectedHash}`);
      // sha256 hex is exactly 64 lowercase hex chars.
      expect(key.split(":")[1]).toMatch(/^[0-9a-f]{64}$/);
    });

    test("collapses messages that differ only by a normalized dynamic value", () => {
      // Two UUIDs normalize to <UUID>, so both throws are one failure mode.
      const first: string = buildExceptionFailureModeKey({
        primaryEntityId: entityId,
        exceptionType: "NotFoundException",
        message: "user 550e8400-e29b-41d4-a716-446655440000 not found",
      });
      const second: string = buildExceptionFailureModeKey({
        primaryEntityId: entityId,
        exceptionType: "NotFoundException",
        message: "user 11111111-2222-3333-4444-555555555555 not found",
      });

      expect(first).toBe(second);
    });

    test("separates different exception types under the same entity", () => {
      const typeError: string = buildExceptionFailureModeKey({
        primaryEntityId: entityId,
        exceptionType: "TypeError",
        message: "same message",
      });
      const rangeError: string = buildExceptionFailureModeKey({
        primaryEntityId: entityId,
        exceptionType: "RangeError",
        message: "same message",
      });

      expect(typeError).not.toBe(rangeError);
    });

    test("separates the same failure across different entities", () => {
      const other: ObjectID = ObjectID.generate();
      const a: string = buildExceptionFailureModeKey({
        primaryEntityId: entityId,
        exceptionType: "TypeError",
        message: "boom",
      });
      const b: string = buildExceptionFailureModeKey({
        primaryEntityId: other,
        exceptionType: "TypeError",
        message: "boom",
      });

      expect(a).not.toBe(b);
      expect(a.startsWith(`${entityId.toString()}:`)).toBe(true);
      expect(b.startsWith(`${other.toString()}:`)).toBe(true);
    });

    test("uses a stable placeholder when the entity is unattributed", () => {
      const key: string = buildExceptionFailureModeKey({
        primaryEntityId: undefined,
        exceptionType: "TypeError",
        message: "boom",
      });

      expect(key.startsWith("unattributed-entity:")).toBe(true);
      // Still deterministic without an entity.
      expect(key).toBe(
        buildExceptionFailureModeKey({
          primaryEntityId: undefined,
          exceptionType: "TypeError",
          message: "boom",
        }),
      );
    });

    test("trims the type before hashing so padding does not fork the key", () => {
      const padded: string = buildExceptionFailureModeKey({
        primaryEntityId: entityId,
        exceptionType: "  TypeError  ",
        message: "  boom  ",
      });
      const clean: string = buildExceptionFailureModeKey({
        primaryEntityId: entityId,
        exceptionType: "TypeError",
        message: "boom",
      });

      expect(padded).toBe(clean);
    });

    test("handles a missing type and message without throwing", () => {
      const key: string = buildExceptionFailureModeKey({
        primaryEntityId: entityId,
        exceptionType: undefined,
        message: undefined,
      });

      const expectedHash: string = Crypto.getSha256Hash(`|`);
      expect(key).toBe(`${entityId.toString()}:${expectedHash}`);
    });
  });
});
