import Domain from "../../Types/Domain";
import BadDataException from "../../Types/Exception/BadDataException";

describe("class Domain", () => {
  test("new Domain() should return a valid object if domain is valid", () => {
    expect(new Domain("example.com")).toBeInstanceOf(Domain);
    expect(new Domain("example.com").toString()).toBe("example.com");
    expect(new Domain("example.com.ac")).toBeInstanceOf(Domain);
    expect(new Domain("example.com.ac").toString()).toBe("example.com.ac");
    expect(new Domain("example.com.ac").domain).toBe("example.com.ac");
    expect(new Domain("example.ac")).toBeInstanceOf(Domain);
    expect(new Domain("example.ac").toString()).toBe("example.ac");
    expect(new Domain("example.ac").domain).toBe("example.ac");
  });
  test("new Domain() should throw the BadDataException if domain is invalid", () => {
    // No dot in domain
    expect(() => {
      return new Domain("example");
    }).toThrowError(BadDataException);
    expect(() => {
      new Domain("example");
    }).toThrowError(BadDataException);

    // Invalid characters
    expect(() => {
      new Domain("example@com");
    }).toThrowError(BadDataException);

    // TLD with numbers (invalid - TLD must be letters only)
    expect(() => {
      new Domain("example.c0m");
    }).toThrowError(BadDataException);

    // Single letter TLD (invalid - TLD must be at least 2 characters)
    expect(() => {
      new Domain("example.c");
    }).toThrowError(BadDataException);

    // Domain starting with hyphen
    expect(() => {
      new Domain("-example.com");
    }).toThrowError(BadDataException);

    // Domain ending with hyphen before TLD
    expect(() => {
      new Domain("example-.com");
    }).toThrowError(BadDataException);

    // Mutation to invalid domain
    expect(() => {
      const validDomain: Domain = new Domain("example.com");
      validDomain.domain = "invalid";
    }).toThrowError(BadDataException);
  });
  test("Domain.domain should be mutable", () => {
    const domain: Domain = new Domain("example.com");
    domain.domain = "example.io";
    expect(domain.domain).toEqual("example.io");
  });
});

describe("Domain.isReservedName", () => {
  test("should return true on the names RFC 2606 reserves, and any name under them", () => {
    const reserved: Array<string> = [
      "example.com",
      "example.net",
      "example.org",
      "mcp.example.com",
      "example.test",
      "acme.example",
      "oneuptime-e2e.invalid",
      "localhost",
      "app.localhost",
      "test",
      "invalid",
    ];

    for (const name of reserved) {
      expect({ name, reserved: Domain.isReservedName(name) }).toEqual({
        name,
        reserved: true,
      });
    }
  });

  test("should ignore case and surrounding spaces", () => {
    expect(Domain.isReservedName("  EXAMPLE.COM ")).toBe(true);
    expect(Domain.isReservedName("Acme.Invalid")).toBe(true);
  });

  test("should return false for names that only look reserved", () => {
    const notReserved: Array<string> = [
      "acme.io",
      "myexample.com",
      "example.com.au",
      "example.co",
      "examples.org",
      "latest.io",
      "invalid.io",
      "test.com",
      "localhost.io",
      "corp.local",
      "company.internal",
      "",
    ];

    for (const name of notReserved) {
      expect({ name, reserved: Domain.isReservedName(name) }).toEqual({
        name,
        reserved: false,
      });
    }
  });

  test("should return false for a value that is not text", () => {
    expect(Domain.isReservedName(undefined as unknown as string)).toBe(false);
    expect(Domain.isReservedName(42 as unknown as string)).toBe(false);
  });

  test("should not change which domains may skip DNS verification", () => {
    expect(Domain.isTestDomain("example.com")).toBe(false);
    expect(Domain.isTestDomain("status.example.com")).toBe(true);
    expect(Domain.isTestDomain("acme.invalid")).toBe(false);
  });
});
