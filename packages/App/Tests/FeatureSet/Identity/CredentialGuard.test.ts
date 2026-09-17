import CredentialGuard from "../../../FeatureSet/Identity/Utils/CredentialGuard";
import BadDataException from "Common/Types/Exception/BadDataException";
import Email from "Common/Types/Email";
import HashedString from "Common/Types/HashedString";
import ObjectID from "Common/Types/ObjectID";
import { describe, expect, it } from "@jest/globals";

/*
 * CredentialGuard is the gate that keeps `undefined` out of WHERE clauses on unauthenticated
 * identity routes. TypeORM DROPS an undefined predicate rather than matching nothing, so a
 * guard that returns true for a value the query layer will discard is itself an auth bypass.
 *
 * The cases below therefore pin down the exact boundary: what reaches a query, and what does not.
 */
describe("CredentialGuard", () => {
  describe("isPresent - values that must be rejected", () => {
    it("rejects undefined, which is what BaseModel.fromJSON({}) leaves on every field", () => {
      expect(CredentialGuard.isPresent(undefined)).toBe(false);
    });

    it("rejects null, which TypeORM also drops by default", () => {
      expect(CredentialGuard.isPresent(null)).toBe(false);
    });

    it("rejects the empty string", () => {
      expect(CredentialGuard.isPresent("")).toBe(false);
    });

    it("rejects whitespace-only strings", () => {
      expect(CredentialGuard.isPresent("   ")).toBe(false);
      expect(CredentialGuard.isPresent("\t\n")).toBe(false);
    });

    it("rejects an empty HashedString, which hashValue() leaves unhashed", async () => {
      const password: HashedString = new HashedString("");

      /*
       * HashedString.hashValue() short-circuits on a falsy value and returns "" without
       * hashing, so an empty password would reach the query as a literal empty string.
       */
      await password.hashValue(new ObjectID("secret"));

      expect(password.toString()).toBe("");
      expect(CredentialGuard.isPresent(password)).toBe(false);
    });

    it("rejects an ObjectID carrying an empty id", () => {
      expect(CredentialGuard.isPresent(new ObjectID(""))).toBe(false);
    });
  });

  describe("isPresent - values that must be accepted", () => {
    it("accepts a non-empty string", () => {
      expect(CredentialGuard.isPresent("a-token")).toBe(true);
    });

    it("accepts a valid Email", () => {
      expect(CredentialGuard.isPresent(new Email("user@example.com"))).toBe(
        true,
      );
    });

    it("accepts a populated ObjectID", () => {
      expect(CredentialGuard.isPresent(ObjectID.generate())).toBe(true);
    });

    it("accepts a populated HashedString both before and after hashing", async () => {
      const password: HashedString = new HashedString("correct-horse");
      expect(CredentialGuard.isPresent(password)).toBe(true);

      await password.hashValue(new ObjectID("secret"));
      expect(CredentialGuard.isPresent(password)).toBe(true);
    });

    it("accepts a plain object, which carries no stringifiable identity to check", () => {
      expect(CredentialGuard.isPresent({ some: "value" })).toBe(true);
    });
  });

  describe("isPresent - falsy primitives that are still real values", () => {
    /*
     * A bare `if (!value)` guard would reject these. They are not credentials today, but the
     * guard is generic and must not silently reject a legitimate zero/false predicate.
     */
    it("accepts 0", () => {
      expect(CredentialGuard.isPresent(0)).toBe(true);
    });

    it("accepts false", () => {
      expect(CredentialGuard.isPresent(false)).toBe(true);
    });
  });

  describe("assertPresent", () => {
    it("throws BadDataException naming the field when the value is missing", () => {
      expect(() => {
        return CredentialGuard.assertPresent(undefined, "Verification token");
      }).toThrow(BadDataException);

      expect(() => {
        return CredentialGuard.assertPresent(undefined, "Verification token");
      }).toThrow("Verification token is required.");
    });

    it("does not leak the rejected value back to the caller", () => {
      let message: string = "";

      try {
        CredentialGuard.assertPresent("", "Password");
      } catch (err) {
        message = (err as BadDataException).message;
      }

      expect(message).toBe("Password is required.");
    });

    it("stays silent for a present value", () => {
      expect(() => {
        return CredentialGuard.assertPresent("token", "Verification token");
      }).not.toThrow();
    });
  });

  describe("assertAllPresent", () => {
    it("throws on the first missing field, regardless of later ones", () => {
      expect(() => {
        return CredentialGuard.assertAllPresent([
          { value: undefined, label: "Email" },
          { value: undefined, label: "Password" },
        ]);
      }).toThrow("Email is required.");
    });

    it("reports the missing field even when earlier fields are present", () => {
      expect(() => {
        return CredentialGuard.assertAllPresent([
          { value: new Email("user@example.com"), label: "Email" },
          { value: undefined, label: "Password" },
        ]);
      }).toThrow("Password is required.");
    });

    it("stays silent when every field is present", () => {
      expect(() => {
        return CredentialGuard.assertAllPresent([
          { value: new Email("user@example.com"), label: "Email" },
          { value: new HashedString("pw"), label: "Password" },
        ]);
      }).not.toThrow();
    });
  });
});
