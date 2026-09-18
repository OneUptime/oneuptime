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
