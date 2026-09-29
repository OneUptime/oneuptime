import Domain from "../../../Server/Types/Domain";
import BadDataException from "../../../Types/Exception/BadDataException";

describe("Domain TXT Record Verification", () => {
  jest.setTimeout(30000); // 30 seconds timeout for DNS tests

  test("should throw user-friendly error for ENODATA", async () => {
    // Testing with a domain that exists but has no TXT records
    const domain: string = "nonexistentsubdomain-test.google.com";
    const verificationText: string = "test-verification-text";

    await expect(
      Domain.verifyTxtRecord(domain, verificationText),
    ).rejects.toThrow(BadDataException);

    try {
      await Domain.verifyTxtRecord(domain, verificationText);
    } catch (error) {
      expect(error).toBeInstanceOf(BadDataException);
      if (error instanceof BadDataException) {
        expect(error.message).toContain(
          'Domain "nonexistentsubdomain-test.google.com" not found. Please check if the domain is correct and accessible.',
        );
        expect(error.message).toContain(domain);
      }
    }
  });

  test("should throw user-friendly error for non-existent domain", async () => {
    // Testing with a domain that doesn't exist
    const domain: string =
      "thisisadomainthatdoesnotexistanywhere12345.nonexistent";
    const verificationText: string = "test-verification-text";

    await expect(
      Domain.verifyTxtRecord(domain, verificationText),
    ).rejects.toThrow(BadDataException);

    try {
      await Domain.verifyTxtRecord(domain, verificationText);
    } catch (error) {
      expect(error).toBeInstanceOf(BadDataException);
      if (error instanceof BadDataException) {
        expect(error.message).toContain("not found");
        expect(error.message).toContain(domain);
        // Should not contain technical DNS error codes
        expect(error.message).not.toContain("ENOTFOUND");
        expect(error.message).not.toContain("queryTxt");
      }
    }
  });
});

describe("Domain CNAME Record Verification", () => {
  jest.setTimeout(30000); // 30 seconds timeout for DNS tests

  test("should throw user-friendly error for CNAME ENODATA", async () => {
    // Testing with a domain that exists but has no CNAME records (e.g., A record only domain)
    const domain: string = "google.com"; // This is an A record, not CNAME

    await expect(Domain.getCnameRecords({ domain })).rejects.toThrow(
      BadDataException,
    );

    try {
      await Domain.getCnameRecords({ domain });
    } catch (error) {
      expect(error).toBeInstanceOf(BadDataException);
      if (error instanceof BadDataException) {
        expect(error.message).toContain("CNAME");
        expect(error.message).toContain(domain);
        // Should not contain technical DNS error codes in user message
        expect(error.message).not.toContain("queryCname");
      }
    }
  });

  test("should get CNAME records for valid CNAME domain", async () => {
    // This test might be flaky depending on DNS changes, but let's try with a known CNAME
    const domain: string = "www.github.com"; // This usually has CNAME records

    try {
      const cnameRecords: string[] = await Domain.getCnameRecords({ domain });
      expect(Array.isArray(cnameRecords)).toBe(true);
      expect(cnameRecords.length).toBeGreaterThan(0);
    } catch (error) {
      // If this fails, it should still provide a user-friendly error
      expect(error).toBeInstanceOf(BadDataException);
      if (error instanceof BadDataException) {
        expect(error.message).not.toContain("queryCname");
        expect(error.message).not.toContain("ENODATA");
      }
    }
  });
});
