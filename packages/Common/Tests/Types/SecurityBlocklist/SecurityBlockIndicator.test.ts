import {
  EMPTY_FILE_HASHES,
  SECURITY_BLOCK_DOMAIN_MAX_LENGTH,
  SECURITY_BLOCK_URL_MAX_LENGTH,
  SecurityBlockHashKind,
  SecurityBlockHashReading,
  SecurityBlockIndicatorProblem,
  SecurityBlockUrlReading,
  getSecurityBlockIndicatorProblem,
  isDomainAtOrUnder,
  isEmptyFileHash,
  isSha512Hash,
  isWildcardDomain,
  readSecurityBlockDomain,
  readSecurityBlockHash,
  readSecurityBlockUrl,
} from "../../../Types/SecurityBlocklist/SecurityBlockIndicator";
import { describe, expect, test } from "@jest/globals";

/*
 * How the blocklist writes a domain, a URL and a file's hash (#10346): one
 * way, however it was typed, so a block, what a destination reads back and
 * the protected list compare the same text.
 */

const SHA256: string =
  "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f";
const SHA1: string = "3395856ce81f2b7382dee72602f798b642f14140";
const MD5: string = "44d88612fea8a8f36de82e1278abb02f";

describe("readSecurityBlockDomain", () => {
  test("lower case, without a trailing dot", () => {
    expect(readSecurityBlockDomain("Evil.Example.")).toEqual({
      domain: "evil.example",
    });
    expect(readSecurityBlockDomain("  WWW.Evil.Example  ")).toEqual({
      domain: "www.evil.example",
    });
  });

  test("an internationalized name as its punycode", () => {
    expect(readSecurityBlockDomain("bücher.example")).toEqual({
      domain: "xn--bcher-kva.example",
    });
  });

  test("a top-level domain of letters, or an internationalized one's punycode", () => {
    expect(readSecurityBlockDomain("evil.co.uk")?.domain).toBe("evil.co.uk");
    expect(readSecurityBlockDomain("evil.xn--p1ai")?.domain).toBe(
      "evil.xn--p1ai",
    );
    expect(readSecurityBlockDomain("evil.c")).toBeNull();
    expect(readSecurityBlockDomain("evil.123")).toBeNull();
    expect(readSecurityBlockDomain("1.2.3.4")).toBeNull();
  });

  test("labels of letters, digits and hyphens, at most 63 long", () => {
    const longest: string = "a".repeat(63);

    expect(readSecurityBlockDomain(`${longest}.example`)?.domain).toBe(
      `${longest}.example`,
    );
    expect(readSecurityBlockDomain(`${"a".repeat(64)}.example`)).toBeNull();
    expect(readSecurityBlockDomain("-evil.example")).toBeNull();
    expect(readSecurityBlockDomain("evil-.example")).toBeNull();
    expect(readSecurityBlockDomain("e-vil.example")?.domain).toBe(
      "e-vil.example",
    );
  });

  test("at most 253 characters in all", () => {
    const label: string = "a".repeat(60);
    const atMost: string = `${label}.${label}.${label}.${label.slice(0, 54)}.ab`;

    expect(atMost.length).toBe(SECURITY_BLOCK_DOMAIN_MAX_LENGTH);
    expect(readSecurityBlockDomain(atMost)?.domain).toBe(atMost);
    expect(readSecurityBlockDomain(`a${atMost}`)).toBeNull();
  });

  test("one label, or what a domain never holds, is not a domain", () => {
    for (const text of [
      "localhost",
      "evil",
      "_dmarc.evil.example",
      "evil example.com",
      "evil.example/login",
      "evil.example:8080",
      "user@evil.example",
      "ev%41il.example",
      "*.evil.example",
      "",
      "   ",
    ]) {
      expect(readSecurityBlockDomain(text)).toBeNull();
    }

    expect(readSecurityBlockDomain(42)).toBeNull();
    expect(readSecurityBlockDomain(undefined)).toBeNull();
  });
});

describe("readSecurityBlockUrl", () => {
  test("http and https only", () => {
    expect(readSecurityBlockUrl("https://evil.example/")?.url).toBe(
      "https://evil.example/",
    );
    expect(readSecurityBlockUrl("http://evil.example/")?.url).toBe(
      "http://evil.example/",
    );
    expect(readSecurityBlockUrl("ftp://evil.example/")).toBeNull();
    expect(readSecurityBlockUrl("ws://evil.example/")).toBeNull();
    expect(readSecurityBlockUrl("evil.example/login")).toBeNull();
  });

  test("its scheme and host lower cased, its path and query as they were", () => {
    expect(
      readSecurityBlockUrl("HTTPS://Evil.Example/Login?Next=/Admin")?.url,
    ).toBe("https://evil.example/Login?Next=/Admin");
  });

  test("its fragment, credentials and default port dropped; another port kept", () => {
    const read: SecurityBlockUrlReading | null = readSecurityBlockUrl(
      "https://bank.example:secret@evil.example:443/pay#section",
    );

    expect(read?.url).toBe("https://evil.example/pay");
    expect(read?.host).toBe("evil.example");
    expect(read?.isAddressHost).toBe(false);
    expect(readSecurityBlockUrl("http://evil.example:8080/x")?.url).toBe(
      "http://evil.example:8080/x",
    );
  });

  test("a host that is an address is read as one", () => {
    const v4: SecurityBlockUrlReading | null = readSecurityBlockUrl(
      "http://198.51.100.7/payload.exe",
    );
    const v6: SecurityBlockUrlReading | null = readSecurityBlockUrl(
      "http://[2001:DB8::7]/payload.exe",
    );

    expect(v4).toEqual({
      url: "http://198.51.100.7/payload.exe",
      host: "198.51.100.7",
      isAddressHost: true,
    });
    expect(v6?.host).toBe("2001:db8::7");
    expect(v6?.isAddressHost).toBe(true);
  });

  test("a host that is neither a domain nor an address is not a URL to block", () => {
    expect(readSecurityBlockUrl("https://localhost/")).toBeNull();
    expect(readSecurityBlockUrl("https://evil/")).toBeNull();
    expect(readSecurityBlockUrl("https://evil .example/")).toBeNull();
    expect(readSecurityBlockUrl("https://")).toBeNull();
    expect(readSecurityBlockUrl(7)).toBeNull();
  });
});

describe("readSecurityBlockHash", () => {
  test("each kind by its length, in lower-case hex", () => {
    const expectHash: (
      text: string,
      kind: SecurityBlockHashKind,
    ) => void = (text: string, kind: SecurityBlockHashKind): void => {
      const read: SecurityBlockHashReading | null = readSecurityBlockHash(
        `  ${text.toUpperCase()}  `,
      );

      expect(read).toEqual({ hash: text, kind });
    };

    expectHash(MD5, SecurityBlockHashKind.Md5);
    expectHash(SHA1, SecurityBlockHashKind.Sha1);
    expectHash(SHA256, SecurityBlockHashKind.Sha256);
  });

  test("another length, or what is not hex, is no hash a block takes", () => {
    expect(readSecurityBlockHash(MD5.slice(1))).toBeNull();
    expect(readSecurityBlockHash(`${MD5}a`)).toBeNull();
    expect(readSecurityBlockHash(`g${MD5.slice(1)}`)).toBeNull();
    expect(readSecurityBlockHash(`${SHA256}${SHA256}`)).toBeNull();
    expect(readSecurityBlockHash(null)).toBeNull();
  });

  test("a SHA-512 digest is a hash, but not one blocked by", () => {
    expect(isSha512Hash(`${SHA256}${SHA256}`)).toBe(true);
    expect(isSha512Hash(SHA256)).toBe(false);
    expect(isSha512Hash(`${"z".repeat(128)}`)).toBe(false);
    expect(isSha512Hash(undefined)).toBe(false);
  });
});

describe("the empty file", () => {
  test("its hash in every form, whatever its case", () => {
    expect(EMPTY_FILE_HASHES.length).toBe(3);

    for (const hash of EMPTY_FILE_HASHES) {
      expect(isEmptyFileHash(hash)).toBe(true);
      expect(isEmptyFileHash(hash.toUpperCase())).toBe(true);
    }

    expect(isEmptyFileHash(MD5)).toBe(false);
    expect(isEmptyFileHash("")).toBe(false);
  });
});

describe("why a value is not one a block takes", () => {
  test("a wildcard domain", () => {
    expect(isWildcardDomain("*.evil.example")).toBe(true);
    expect(isWildcardDomain("evil*.example")).toBe(true);
    expect(isWildcardDomain("evil.example")).toBe(false);
    expect(isWildcardDomain("https://*.evil.example/")).toBe(false);
    expect(isWildcardDomain(5)).toBe(false);
    expect(getSecurityBlockIndicatorProblem("*.evil.example")).toBe(
      SecurityBlockIndicatorProblem.Wildcard,
    );
  });

  test("a SHA-512 digest", () => {
    expect(getSecurityBlockIndicatorProblem(`${SHA256}${SHA256}`)).toBe(
      SecurityBlockIndicatorProblem.UnsupportedHash,
    );
  });

  test("a URL of another scheme, or longer than a block holds", () => {
    expect(getSecurityBlockIndicatorProblem("ftp://evil.example/x")).toBe(
      SecurityBlockIndicatorProblem.UrlScheme,
    );

    const long: string = `https://evil.example/${"a".repeat(SECURITY_BLOCK_URL_MAX_LENGTH)}`;

    expect(getSecurityBlockIndicatorProblem(long)).toBe(
      SecurityBlockIndicatorProblem.UrlTooLong,
    );

    const longest: string = `https://evil.example/${"a".repeat(SECURITY_BLOCK_URL_MAX_LENGTH - "https://evil.example/".length)}`;

    expect(longest.length).toBe(SECURITY_BLOCK_URL_MAX_LENGTH);
    expect(getSecurityBlockIndicatorProblem(longest)).toBeNull();
  });

  test("nothing worth saying for a value, or for text that is none", () => {
    for (const text of [
      "evil.example",
      "https://evil.example/",
      MD5,
      "198.51.100.7",
      "not a thing",
    ]) {
      expect(getSecurityBlockIndicatorProblem(text)).toBeNull();
    }

    expect(getSecurityBlockIndicatorProblem(undefined)).toBeNull();
  });
});

describe("isDomainAtOrUnder", () => {
  test("the same name, or one under it", () => {
    expect(isDomainAtOrUnder("evil.example", "evil.example")).toBe(true);
    expect(isDomainAtOrUnder("a.evil.example", "evil.example")).toBe(true);
    expect(isDomainAtOrUnder("A.Evil.Example", "evil.example")).toBe(true);
  });

  test("never a name that only ends the same way, nor a name above it", () => {
    expect(isDomainAtOrUnder("notevil.example", "evil.example")).toBe(false);
    expect(isDomainAtOrUnder("evil.example", "a.evil.example")).toBe(false);
    expect(isDomainAtOrUnder("", "evil.example")).toBe(false);
    expect(isDomainAtOrUnder("evil.example", "")).toBe(false);
  });
});
