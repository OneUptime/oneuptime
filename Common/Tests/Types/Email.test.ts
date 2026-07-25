import Email from "../../Types/Email";
import BadDataException from "../../Types/Exception/BadDataException";
import { ObjectType } from "../../Types/JSON";

describe("Email", () => {
  describe("isValid", () => {
    test("should accept well formed addresses", () => {
      const valid: Array<string> = [
        "user@example.com",
        "user.name+tag@example.co.uk",
        "user_name@sub.domain.example.com",
        "user-name@example.io",
        "u@e.co",
      ];

      for (const value of valid) {
        expect(Email.isValid(value)).toBe(true);
      }
    });

    test("should reject malformed addresses", () => {
      const invalid: Array<string> = [
        "",
        "userexample.com",
        "@example.com",
        "user@",
        "user@@example.com",
        "user @example.com",
      ];

      for (const value of invalid) {
        expect(Email.isValid(value)).toBe(false);
      }
    });
  });

  describe("constructor", () => {
    test("should trim and lowercase the address", () => {
      expect(new Email("  User.Name@Example.COM  ").toString()).toEqual(
        "user.name@example.com",
      );
    });

    test("should throw BadDataException for an invalid address", () => {
      expect(() => {
        return new Email("not-an-email");
      }).toThrow(BadDataException);
    });

    test("should throw BadDataException for an empty address", () => {
      expect(() => {
        return new Email("");
      }).toThrow(BadDataException);
    });
  });

  describe("fromString", () => {
    test("should build an Email instance", () => {
      const email: Email = Email.fromString("user@example.com");

      expect(email).toBeInstanceOf(Email);
      expect(email.toString()).toEqual("user@example.com");
    });
  });

  describe("getEmailDomain", () => {
    test("should return the hostname after the @", () => {
      expect(
        new Email("user@sub.example.com").getEmailDomain().hostname,
      ).toEqual("sub.example.com");
    });
  });

  describe("isBusinessEmail", () => {
    test("should return false for well known consumer providers", () => {
      const consumer: Array<string> = [
        "user@gmail.com",
        "user@yahoo.com",
        "user@hotmail.com",
        "user@outlook.com",
        "user@icloud.com",
        "user@protonmail.com",
        "user@yandex.com",
      ];

      for (const value of consumer) {
        expect(new Email(value).isBusinessEmail()).toBe(false);
      }
    });

    test("should return true for company domains", () => {
      expect(new Email("user@oneuptime.com").isBusinessEmail()).toBe(true);
      expect(new Email("user@acme.io").isBusinessEmail()).toBe(true);
    });
  });

  describe("parseList", () => {
    test("should return an empty list for null, undefined and empty input", () => {
      expect(Email.parseList(null)).toEqual([]);
      expect(Email.parseList(undefined)).toEqual([]);
      expect(Email.parseList("")).toEqual([]);
    });

    test("should split on commas, semicolons and whitespace", () => {
      const emails: Array<Email> = Email.parseList(
        "a@example.com, b@example.com; c@example.com d@example.com",
      );

      expect(
        emails.map((e: Email) => {
          return e.toString();
        }),
      ).toEqual([
        "a@example.com",
        "b@example.com",
        "c@example.com",
        "d@example.com",
      ]);
    });

    test("should de-duplicate addresses case insensitively", () => {
      const emails: Array<Email> = Email.parseList(
        "a@example.com, A@Example.com, b@example.com",
      );

      expect(emails.length).toEqual(2);
      expect(emails[0]!.toString()).toEqual("a@example.com");
      expect(emails[1]!.toString()).toEqual("b@example.com");
    });

    test("should throw when any entry in the list is invalid", () => {
      expect(() => {
        return Email.parseList("a@example.com, not-an-email");
      }).toThrow(BadDataException);
    });
  });

  describe("isValidList", () => {
    test("should treat null, undefined and empty input as valid", () => {
      expect(Email.isValidList(null)).toBe(true);
      expect(Email.isValidList(undefined)).toBe(true);
      expect(Email.isValidList("")).toBe(true);
    });

    test("should return false when the input has only separators", () => {
      expect(Email.isValidList(" , ; ")).toBe(false);
    });

    test("should validate every entry", () => {
      expect(Email.isValidList("a@example.com; b@example.com")).toBe(true);
      expect(Email.isValidList("a@example.com, bad")).toBe(false);
    });
  });

  describe("toJSON / fromJSON", () => {
    test("should round trip through JSON", () => {
      const email: Email = new Email("user@example.com");
      const json: ReturnType<Email["toJSON"]> = email.toJSON();

      expect(json).toEqual({
        _type: ObjectType.Email,
        value: "user@example.com",
      });
      expect(Email.fromJSON(json).toString()).toEqual("user@example.com");
    });

    test("should throw when the JSON is not an Email object", () => {
      expect(() => {
        return Email.fromJSON({ _type: "SomethingElse", value: "x@y.com" });
      }).toThrow(BadDataException);
    });
  });

  describe("toDatabase / fromDatabase", () => {
    test("should convert to a plain string for the database", () => {
      expect(Email.toDatabase(new Email("user@example.com"))).toEqual(
        "user@example.com",
      );
    });

    test("should accept a raw string and normalize it", () => {
      expect(Email.toDatabase("User@Example.com" as unknown as Email)).toEqual(
        "user@example.com",
      );
    });

    test("should return null for empty database values", () => {
      expect(Email.toDatabase(null as unknown as Email)).toBeNull();
      expect(Email.fromDatabase("")).toBeNull();
    });

    test("should hydrate from a database string", () => {
      expect(Email.fromDatabase("user@example.com")?.toString()).toEqual(
        "user@example.com",
      );
    });
  });
});
