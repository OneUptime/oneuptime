import { describe, expect, test } from "@jest/globals";
import {
  ProjectDomainOption,
  findProjectDomainForAddress,
  getDomainToAddForAddress,
  getSubdomainOnDomain,
  isAddressOnDomain,
  parseCustomDomainAddress,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainAddress";

/*
 * Add Custom Domain asks for the address people will open
 * (status.example.com) and works out the project domain it belongs to, so a
 * person who starts on the status page never has to leave it to add and
 * verify a domain in Project Settings first.
 */

function option(
  domain: string,
  isVerified: boolean,
  id?: string,
): ProjectDomainOption {
  return {
    id: id || domain,
    domain,
    isVerified,
    verificationText: `oneuptime-verification-${domain}`,
  };
}

describe("parseCustomDomainAddress", () => {
  test("reads a hostname, ignoring case, spaces and the root's trailing dot", () => {
    expect(parseCustomDomainAddress("  Status.Example.COM. ")).toEqual({
      fullDomain: "status.example.com",
    });
  });

  test("a pasted link is cut to its host", () => {
    for (const typed of [
      "https://status.example.com",
      "https://status.example.com/",
      "http://status.example.com:8080/path?query=1#top",
      "https://user:pass@status.example.com/",
      "status.example.com/some/page",
    ]) {
      expect([typed, parseCustomDomainAddress(typed)]).toEqual([
        typed,
        { fullDomain: "status.example.com" },
      ]);
    }
  });

  test("anything that is not a hostname of two labels or more is refused", () => {
    for (const typed of [
      "",
      "   ",
      undefined,
      null,
      "localhost",
      "status",
      "status..example.com",
      "-status.example.com",
      "status-.example.com",
      "stat us.example.com",
      "status_page.example.com",
      "*.example.com",
      "203.0.113.10",
      `${"a".repeat(64)}.example.com`,
      `${"a.".repeat(130)}com`,
    ]) {
      expect([typed, parseCustomDomainAddress(typed)]).toEqual([
        typed,
        undefined,
      ]);
    }
  });

  test("internationalized names are typed in their ASCII form", () => {
    expect(parseCustomDomainAddress("status.xn--bcher-kva.example")).toEqual({
      fullDomain: "status.xn--bcher-kva.example",
    });
  });
});

describe("the project domain an address belongs to", () => {
  test("an address is on a domain when it is the domain, or ends with it after a dot", () => {
    expect(isAddressOnDomain("status.example.com", "example.com")).toBe(true);
    expect(isAddressOnDomain("example.com", "example.com")).toBe(true);
    expect(isAddressOnDomain("status.example.com", "Example.COM.")).toBe(true);
    // Not a suffix of a label: myexample.com is not on example.com.
    expect(isAddressOnDomain("status.myexample.com", "example.com")).toBe(
      false,
    );
    expect(isAddressOnDomain("status.example.com", "")).toBe(false);
  });

  test("the longest of the project's domains wins", () => {
    const found: ProjectDomainOption | undefined = findProjectDomainForAddress(
      "status.eu.example.com",
      [
        option("example.com", true),
        option("eu.example.com", false),
        option("other.com", true),
      ],
    );

    expect(found?.domain).toBe("eu.example.com");
  });

  test("of two with the same name, a verified one", () => {
    expect(
      findProjectDomainForAddress("status.example.com", [
        option("example.com", false, "1"),
        option("example.com", true, "2"),
      ])?.id,
    ).toBe("2");
    expect(
      findProjectDomainForAddress("status.example.com", [
        option("example.com", true, "2"),
        option("example.com", false, "1"),
      ])?.id,
    ).toBe("2");
  });

  test("none when no domain of the project covers the address", () => {
    expect(
      findProjectDomainForAddress("status.example.com", [
        option("example.org", true),
        option("myexample.com", true),
      ]),
    ).toBeUndefined();
    expect(findProjectDomainForAddress("status.example.com", [])).toBe(
      undefined,
    );
  });
});

describe("the domain to add when the project has none", () => {
  test("the address without its first label", () => {
    expect(getDomainToAddForAddress("status.example.com")).toBe("example.com");
    expect(getDomainToAddForAddress("status.eu.example.com")).toBe(
      "eu.example.com",
    );
  });

  test("the address itself when it is the root of a domain", () => {
    expect(getDomainToAddForAddress("example.com")).toBe("example.com");
  });

  test("never a public suffix under a country code", () => {
    expect(getDomainToAddForAddress("example.co.uk")).toBe("example.co.uk");
    expect(getDomainToAddForAddress("acme.com.au")).toBe("acme.com.au");
    expect(getDomainToAddForAddress("status.example.co.uk")).toBe(
      "example.co.uk",
    );
    // A real domain of two letters under a country code is not a suffix.
    expect(getDomainToAddForAddress("status.ab.de")).toBe("ab.de");
  });
});

describe("the subdomain the custom domain is added with", () => {
  test("what comes before its domain, or empty for the root", () => {
    expect(getSubdomainOnDomain("status.example.com", "example.com")).toBe(
      "status",
    );
    expect(getSubdomainOnDomain("status.eu.example.com", "example.com")).toBe(
      "status.eu",
    );
    expect(getSubdomainOnDomain("example.com", "example.com")).toBe("");
    expect(getSubdomainOnDomain("status.example.com", "Example.com.")).toBe(
      "status",
    );
  });
});
