import VersionUtil, { ParsedVersion } from "../../Utils/VersionUtil";

describe("VersionUtil", () => {
  describe("normalize", () => {
    it("strips a leading v from a GitHub tag name", () => {
      expect(VersionUtil.normalize("v11.5.13")).toBe("11.5.13");
      expect(VersionUtil.normalize("V11.5.13")).toBe("11.5.13");
    });

    it("trims surrounding whitespace", () => {
      expect(VersionUtil.normalize("  11.5.13\n")).toBe("11.5.13");
    });

    it("returns an empty string for non-strings", () => {
      expect(VersionUtil.normalize(null)).toBe("");
      expect(VersionUtil.normalize(undefined)).toBe("");
      expect(VersionUtil.normalize(11)).toBe("");
      expect(VersionUtil.normalize({ version: "1.0.0" })).toBe("");
    });

    it("caps absurdly long input", () => {
      expect(VersionUtil.normalize("1".repeat(5000)).length).toBe(100);
    });
  });

  describe("parse", () => {
    it("parses a plain release", () => {
      const parsed: ParsedVersion | null = VersionUtil.parse("11.5.13");

      expect(parsed).toEqual({
        major: 11,
        minor: 5,
        patch: 13,
        prerelease: null,
      });
    });

    it("parses a prerelease", () => {
      const parsed: ParsedVersion | null = VersionUtil.parse("11.6.0-rc.1");

      expect(parsed).toEqual({
        major: 11,
        minor: 6,
        patch: 0,
        prerelease: "rc.1",
      });
    });

    it("discards build metadata, which takes no part in precedence", () => {
      expect(VersionUtil.parse("11.5.13+abc123")?.prerelease).toBeNull();
      expect(VersionUtil.compare("11.5.13+abc123", "11.5.13")).toBe(0);
    });

    it("returns null for partial, empty and garbage versions", () => {
      const invalid: Array<unknown> = [
        "11.5",
        "11",
        "",
        "   ",
        "latest",
        "unknown",
        "v",
        "1.0.0.0",
        "-1.0.0",
        "1.0.0-",
        null,
        undefined,
        11.5,
        {},
        [],
      ];

      for (const value of invalid) {
        expect(VersionUtil.parse(value)).toBeNull();
      }
    });

    it("rejects numbers too large to be a real version", () => {
      expect(VersionUtil.parse("99999999999.0.0")).toBeNull();
    });

    it("reports validity", () => {
      expect(VersionUtil.isValid("11.5.13")).toBe(true);
      expect(VersionUtil.isValid("unknown")).toBe(false);
    });
  });

  describe("canonicalize", () => {
    it("rebuilds the version from its parts", () => {
      expect(VersionUtil.canonicalize("11.5.13")).toBe("11.5.13");
      expect(VersionUtil.canonicalize("v11.5.13")).toBe("11.5.13");
      expect(VersionUtil.canonicalize("  11.6.0-rc.1 ")).toBe("11.6.0-rc.1");
    });

    /*
     * A caller that validates with isValid() and then stores the string it
     * passed in can end up storing "v11.5.13" for the input "vv11.5.13",
     * because normalize() strips one "v" per call and isValid() normalizes a
     * second time. canonicalize is the fix: it rebuilds from a single parse,
     * so a doubled prefix is simply not a version and the result never carries
     * a "v" for the UIs to double up on.
     */
    it("never returns a value that still carries a v prefix", () => {
      expect(VersionUtil.canonicalize("vv11.5.13")).toBeNull();
      expect(VersionUtil.canonicalize("vV11.5.13")).toBeNull();

      for (const value of ["11.5.13", "v11.5.13", "  V11.5.13  "]) {
        expect(VersionUtil.canonicalize(value)).toBe("11.5.13");
      }
    });

    it("drops build metadata, which takes no part in precedence", () => {
      expect(VersionUtil.canonicalize("11.5.13+abc123")).toBe("11.5.13");
    });

    it("is idempotent", () => {
      const once: string | null = VersionUtil.canonicalize("v11.5.13");

      expect(VersionUtil.canonicalize(once)).toBe(once);
    });

    it("returns null for anything that is not a version", () => {
      expect(VersionUtil.canonicalize("unknown")).toBeNull();
      expect(VersionUtil.canonicalize("")).toBeNull();
      expect(VersionUtil.canonicalize(null)).toBeNull();
      expect(VersionUtil.canonicalize("vvv1.2.3")).toBeNull();
    });
  });

  describe("compare", () => {
    it("orders by major, then minor, then patch", () => {
      expect(VersionUtil.compare("10.0.0", "11.0.0")).toBe(-1);
      expect(VersionUtil.compare("11.4.0", "11.5.0")).toBe(-1);
      expect(VersionUtil.compare("11.5.12", "11.5.13")).toBe(-1);
      expect(VersionUtil.compare("11.5.13", "11.5.12")).toBe(1);
      expect(VersionUtil.compare("2.0.0", "10.0.0")).toBe(-1);
    });

    it("treats equal versions as equal regardless of a v prefix", () => {
      expect(VersionUtil.compare("11.5.13", "v11.5.13")).toBe(0);
    });

    it("ranks a prerelease below the release of the same triple", () => {
      expect(VersionUtil.compare("11.6.0-rc.1", "11.6.0")).toBe(-1);
      expect(VersionUtil.compare("11.6.0", "11.6.0-rc.1")).toBe(1);
    });

    it("orders prerelease identifiers by semver precedence", () => {
      expect(VersionUtil.compare("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1);
      expect(VersionUtil.compare("1.0.0-alpha.1", "1.0.0-alpha.beta")).toBe(-1);
      expect(VersionUtil.compare("1.0.0-alpha.beta", "1.0.0-beta")).toBe(-1);
      expect(VersionUtil.compare("1.0.0-beta.2", "1.0.0-beta.11")).toBe(-1);
      expect(VersionUtil.compare("1.0.0-rc.1", "1.0.0-rc.1")).toBe(0);
    });

    it("returns null when either side cannot be parsed", () => {
      expect(VersionUtil.compare("unknown", "11.5.13")).toBeNull();
      expect(VersionUtil.compare("11.5.13", "")).toBeNull();
      expect(VersionUtil.compare(null, undefined)).toBeNull();
    });

    it("is antisymmetric across a range of pairs", () => {
      const versions: Array<string> = [
        "1.0.0",
        "1.0.1",
        "1.1.0",
        "2.0.0",
        "11.5.13",
      ];

      for (const a of versions) {
        for (const b of versions) {
          const forward: number = VersionUtil.compare(a, b) as number;
          const reverse: number = VersionUtil.compare(b, a) as number;

          // `|| 0` keeps the negation of 0 from producing -0, which toBe rejects.
          expect(forward).toBe(-reverse || 0);
        }
      }
    });
  });

  describe("isUpdateAvailable", () => {
    it("is true only when the latest release is strictly newer", () => {
      expect(
        VersionUtil.isUpdateAvailable({
          currentVersion: "11.5.13",
          latestVersion: "11.6.0",
        }),
      ).toBe(true);

      expect(
        VersionUtil.isUpdateAvailable({
          currentVersion: "11.5.13",
          latestVersion: "v11.5.14",
        }),
      ).toBe(true);
    });

    it("is false when the installation is up to date", () => {
      expect(
        VersionUtil.isUpdateAvailable({
          currentVersion: "11.5.13",
          latestVersion: "11.5.13",
        }),
      ).toBe(false);
    });

    it("never suggests a downgrade for a build ahead of the release", () => {
      expect(
        VersionUtil.isUpdateAvailable({
          currentVersion: "11.6.0",
          latestVersion: "11.5.13",
        }),
      ).toBe(false);
    });

    it("never nudges a stable installation onto a prerelease", () => {
      expect(
        VersionUtil.isUpdateAvailable({
          currentVersion: "11.5.13",
          latestVersion: "11.6.0-beta.1",
        }),
      ).toBe(false);
    });

    it("does tell a release candidate about the matching stable release", () => {
      expect(
        VersionUtil.isUpdateAvailable({
          currentVersion: "11.6.0-rc.1",
          latestVersion: "11.6.0",
        }),
      ).toBe(true);
    });

    it("is false when the latest release is a prerelease of a new major", () => {
      expect(
        VersionUtil.isUpdateAvailable({
          currentVersion: "11.5.13",
          latestVersion: "12.0.0-rc.1",
        }),
      ).toBe(false);
    });

    it("is false whenever either version is unknown or missing", () => {
      const unknownValues: Array<unknown> = [
        "unknown",
        "",
        null,
        undefined,
        "latest",
        42,
      ];

      for (const value of unknownValues) {
        expect(
          VersionUtil.isUpdateAvailable({
            currentVersion: value,
            latestVersion: "11.6.0",
          }),
        ).toBe(false);

        expect(
          VersionUtil.isUpdateAvailable({
            currentVersion: "11.5.13",
            latestVersion: value,
          }),
        ).toBe(false);
      }
    });
  });

  describe("isMajorUpgrade", () => {
    it("is true only when the update crosses a major version", () => {
      expect(
        VersionUtil.isMajorUpgrade({
          currentVersion: "11.5.13",
          latestVersion: "12.0.0",
        }),
      ).toBe(true);

      expect(
        VersionUtil.isMajorUpgrade({
          currentVersion: "10.9.9",
          latestVersion: "12.0.0",
        }),
      ).toBe(true);
    });

    it("is false for a minor or patch update", () => {
      expect(
        VersionUtil.isMajorUpgrade({
          currentVersion: "11.5.13",
          latestVersion: "11.6.0",
        }),
      ).toBe(false);

      expect(
        VersionUtil.isMajorUpgrade({
          currentVersion: "11.5.13",
          latestVersion: "11.5.14",
        }),
      ).toBe(false);
    });

    it("is false when there is no update to take at all", () => {
      expect(
        VersionUtil.isMajorUpgrade({
          currentVersion: "12.0.0",
          latestVersion: "12.0.0",
        }),
      ).toBe(false);

      // Ahead of the release — a new major behind us is still not an upgrade.
      expect(
        VersionUtil.isMajorUpgrade({
          currentVersion: "12.1.0",
          latestVersion: "11.9.9",
        }),
      ).toBe(false);
    });

    it("is false when the new major is only a prerelease", () => {
      expect(
        VersionUtil.isMajorUpgrade({
          currentVersion: "11.5.13",
          latestVersion: "12.0.0-rc.1",
        }),
      ).toBe(false);
    });

    it("is false whenever either version is unknown or missing", () => {
      expect(
        VersionUtil.isMajorUpgrade({
          currentVersion: "unknown",
          latestVersion: "12.0.0",
        }),
      ).toBe(false);

      expect(
        VersionUtil.isMajorUpgrade({
          currentVersion: "11.5.13",
          latestVersion: null,
        }),
      ).toBe(false);
    });
  });
});
