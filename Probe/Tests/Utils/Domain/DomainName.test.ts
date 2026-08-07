import DomainNameUtil from "../../../Utils/Domain/DomainName";
import { describe, expect, it } from "@jest/globals";

describe("DomainNameUtil", () => {
  describe("normalize", () => {
    it("lowercases and trims", () => {
      expect(DomainNameUtil.normalize("  ExAmPle.COM  ")).toBe("example.com");
    });

    it("strips a scheme that was pasted along with the name", () => {
      expect(DomainNameUtil.normalize("https://example.com")).toBe(
        "example.com",
      );
      expect(DomainNameUtil.normalize("http://example.com")).toBe(
        "example.com",
      );
    });

    it("strips path, query and fragment", () => {
      expect(DomainNameUtil.normalize("https://example.com/pricing")).toBe(
        "example.com",
      );
      expect(DomainNameUtil.normalize("example.com/a/b?c=d#e")).toBe(
        "example.com",
      );
    });

    it("strips a port", () => {
      expect(DomainNameUtil.normalize("example.com:8080")).toBe("example.com");
    });

    it("strips credentials", () => {
      expect(DomainNameUtil.normalize("https://user:pass@example.com")).toBe(
        "example.com",
      );
    });

    it("strips the root label's trailing dot", () => {
      expect(DomainNameUtil.normalize("example.com.")).toBe("example.com");
    });

    it("returns an empty string for empty input", () => {
      expect(DomainNameUtil.normalize("")).toBe("");
      expect(DomainNameUtil.normalize("   ")).toBe("");
    });

    it("keeps an '@' that belongs to the path out of the host", () => {
      expect(DomainNameUtil.normalize("https://example.com/u/@handle")).toBe(
        "example.com",
      );
    });

    /*
     * Registries, the IANA bootstrap registry and WHOIS servers all key on
     * A-labels. whois-json used to punycode the name itself, so skipping the
     * conversion here would reject every IDN monitor before any lookup.
     */
    it("converts an IDN to its A-label form", () => {
      expect(DomainNameUtil.normalize("münchen.de")).toBe("xn--mnchen-3ya.de");
      expect(DomainNameUtil.normalize("CAFÉ.fr")).toBe("xn--caf-dma.fr");
    });

    it("leaves an already-punycoded name alone", () => {
      expect(DomainNameUtil.normalize("xn--mnchen-3ya.de")).toBe(
        "xn--mnchen-3ya.de",
      );
    });

    it("keeps the original value when it cannot be mapped, so errors can name it", () => {
      expect(DomainNameUtil.normalize("not a domain")).toBe("not a domain");
    });
  });

  describe("isValid", () => {
    it("accepts ordinary names", () => {
      expect(DomainNameUtil.isValid("example.com")).toBe(true);
      expect(DomainNameUtil.isValid("identity.digital")).toBe(true);
      expect(DomainNameUtil.isValid("a-b.co.uk")).toBe(true);
      expect(DomainNameUtil.isValid("xn--80ak6aa92e.com")).toBe(true);
    });

    it("rejects a single label", () => {
      expect(DomainNameUtil.isValid("localhost")).toBe(false);
      expect(DomainNameUtil.isValid("com")).toBe(false);
    });

    it("rejects empty and over-long names", () => {
      expect(DomainNameUtil.isValid("")).toBe(false);
      expect(
        DomainNameUtil.isValid(`${"a".repeat(250)}.${"b".repeat(10)}.com`),
      ).toBe(false);
    });

    it("rejects labels with invalid characters or edge hyphens", () => {
      expect(DomainNameUtil.isValid("exa_mple.com")).toBe(false);
      expect(DomainNameUtil.isValid("-example.com")).toBe(false);
      expect(DomainNameUtil.isValid("example-.com")).toBe(false);
      expect(DomainNameUtil.isValid("example..com")).toBe(false);
      expect(DomainNameUtil.isValid("exam ple.com")).toBe(false);
    });

    it("rejects an IP address", () => {
      expect(DomainNameUtil.isValid("192.0.2.1")).toBe(false);
    });

    it("rejects a label longer than 63 characters", () => {
      expect(DomainNameUtil.isValid(`${"a".repeat(64)}.com`)).toBe(false);
      expect(DomainNameUtil.isValid(`${"a".repeat(63)}.com`)).toBe(true);
    });
  });

  describe("getTld", () => {
    it("returns the rightmost label", () => {
      expect(DomainNameUtil.getTld("identity.digital")).toBe("digital");
      expect(DomainNameUtil.getTld("a.b.example.co.uk")).toBe("uk");
    });
  });

  describe("getSuffixCandidates", () => {
    it("returns every trailing run of labels, longest first", () => {
      expect(DomainNameUtil.getSuffixCandidates("a.b.example.com")).toEqual([
        "a.b.example.com",
        "b.example.com",
        "example.com",
        "com",
      ]);
    });

    it("ignores empty labels", () => {
      expect(DomainNameUtil.getSuffixCandidates("example.com.")).toEqual([
        "example.com",
        "com",
      ]);
    });

    it("handles a single label", () => {
      expect(DomainNameUtil.getSuffixCandidates("digital")).toEqual([
        "digital",
      ]);
    });
  });
});
