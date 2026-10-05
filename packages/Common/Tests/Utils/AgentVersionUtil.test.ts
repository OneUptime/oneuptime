import { describe, expect, test } from "@jest/globals";
import AgentVersionUtil, {
  AgentVersionStatus,
} from "../../Utils/AgentVersionUtil";

/*
 * The one rule behind the sign beside an outdated agent version: is the
 * version an agent reported older than the newest one? A wrong "outdated"
 * sends someone to upgrade an agent that is fine, so these pin that every
 * uncertain case is Unknown, and that versions compare as semantic versions,
 * never as strings.
 */

function statusOf(
  agentVersion: unknown,
  latestVersion: unknown,
  placeholderVersions?: Array<string>,
): AgentVersionStatus {
  return AgentVersionUtil.getStatus({
    agentVersion,
    latestVersion,
    placeholderVersions,
  });
}

describe("AgentVersionUtil.getStatus", () => {
  describe("an older agent is Outdated", () => {
    test.each([
      ["patch", "14.0.10", "14.0.14"],
      ["minor", "14.0.14", "14.1.0"],
      ["major", "13.9.99", "14.0.0"],
      ["the screenshot's cluster", "14.0.10", "14.0.14"],
      ["a collector pin", "0.154.0", "0.161.0"],
    ])("%s: %s against %s", (_: string, agent: string, latest: string) => {
      expect(statusOf(agent, latest)).toBe(AgentVersionStatus.Outdated);
      expect(
        AgentVersionUtil.isOutdated({
          agentVersion: agent,
          latestVersion: latest,
        }),
      ).toBe(true);
    });
  });

  describe("versions compare as numbers, never as strings", () => {
    test("14.0.9 is older than 14.0.10 (a string compare says newer)", () => {
      expect("14.0.9" > "14.0.10").toBe(true);
      expect(statusOf("14.0.9", "14.0.10")).toBe(AgentVersionStatus.Outdated);
    });

    test("14.0.10 is newer than 14.0.9 (a string compare says older)", () => {
      expect(statusOf("14.0.10", "14.0.9")).toBe(AgentVersionStatus.UpToDate);
    });

    test("9.9.9 is older than 10.0.0 (a string compare says newer)", () => {
      expect(statusOf("9.9.9", "10.0.0")).toBe(AgentVersionStatus.Outdated);
      expect(statusOf("10.0.0", "9.9.9")).toBe(AgentVersionStatus.UpToDate);
    });
  });

  describe("level with or ahead of the newest is UpToDate", () => {
    test.each([
      ["the same release", "14.0.14", "14.0.14"],
      [
        "a newer patch (a self-hosted server older than the image)",
        "14.0.15",
        "14.0.14",
      ],
      ["a newer minor", "14.1.0", "14.0.14"],
      ["a newer major", "15.0.0", "14.0.14"],
      ["a OneUptime version against a collector pin", "14.0.10", "0.161.0"],
    ])("%s", (_: string, agent: string, latest: string) => {
      expect(statusOf(agent, latest)).toBe(AgentVersionStatus.UpToDate);
      expect(
        AgentVersionUtil.isOutdated({
          agentVersion: agent,
          latestVersion: latest,
        }),
      ).toBe(false);
    });
  });

  describe("pre-releases", () => {
    test("a release candidate agent is older than the release it leads to", () => {
      expect(statusOf("14.0.14-rc.1", "14.0.14")).toBe(
        AgentVersionStatus.Outdated,
      );
    });

    test("a release candidate of the next release is newer than this one", () => {
      expect(statusOf("14.0.15-rc.1", "14.0.14")).toBe(
        AgentVersionStatus.UpToDate,
      );
    });

    test("a server on a pre-release says nothing: the upgrade pulls the newest stable release, which never reaches it", () => {
      expect(statusOf("14.0.10", "14.1.0-rc.1")).toBe(
        AgentVersionStatus.Unknown,
      );
      expect(statusOf("13.0.0", "14.1.0-beta.2")).toBe(
        AgentVersionStatus.Unknown,
      );
    });
  });

  describe("spellings of the same version", () => {
    test("a leading v is the same version", () => {
      expect(statusOf("v14.0.10", "14.0.14")).toBe(AgentVersionStatus.Outdated);
      expect(statusOf("14.0.14", "v14.0.14")).toBe(AgentVersionStatus.UpToDate);
    });

    test("surrounding whitespace is ignored", () => {
      expect(statusOf(" 14.0.10\n", "14.0.14")).toBe(
        AgentVersionStatus.Outdated,
      );
    });

    test("build metadata takes no part", () => {
      expect(statusOf("14.0.14+abc123", "14.0.14")).toBe(
        AgentVersionStatus.UpToDate,
      );
      expect(statusOf("14.0.10+abc123", "14.0.14")).toBe(
        AgentVersionStatus.Outdated,
      );
    });
  });

  describe("a missing or unparsable agent version is Unknown, never Outdated", () => {
    test.each([
      ["undefined", undefined],
      ["null", null],
      ["empty", ""],
      ["blank", "   "],
      ["unknown", "unknown"],
      ["two parts", "14.0"],
      ["four parts", "14.0.10.1"],
      ["a word", "latest"],
      ["a number", 14],
      ["an object", { version: "14.0.10" }],
      ["absurdly long", "1".repeat(5000)],
    ])("%s", (_: string, agent: unknown) => {
      expect(statusOf(agent, "14.0.14")).toBe(AgentVersionStatus.Unknown);
    });
  });

  describe("a missing or unparsable newest version is Unknown", () => {
    test.each([
      ["a dev server with no APP_VERSION", ""],
      ["undefined", undefined],
      ["null", null],
      ["unknown", "unknown"],
      ["a branch name", "master"],
    ])("%s", (_: string, latest: unknown) => {
      expect(statusOf("1.0.0", latest)).toBe(AgentVersionStatus.Unknown);
      expect(statusOf("14.0.10", latest)).toBe(AgentVersionStatus.Unknown);
    });
  });

  describe("placeholder versions mean 'not reported'", () => {
    test("the placeholder is Unknown however old it looks", () => {
      expect(statusOf("1.0.0", "14.0.14", ["1.0.0"])).toBe(
        AgentVersionStatus.Unknown,
      );
    });

    test("other spellings of the placeholder are the placeholder", () => {
      expect(statusOf("v1.0.0", "14.0.14", ["1.0.0"])).toBe(
        AgentVersionStatus.Unknown,
      );
      expect(statusOf("1.0.0+dev", "14.0.14", ["1.0.0"])).toBe(
        AgentVersionStatus.Unknown,
      );
    });

    test("without a placeholder list, 1.0.0 is just an old version", () => {
      expect(statusOf("1.0.0", "14.0.14")).toBe(AgentVersionStatus.Outdated);
      expect(statusOf("1.0.0", "14.0.14", [])).toBe(
        AgentVersionStatus.Outdated,
      );
    });

    test("a placeholder list does not hide real old versions", () => {
      expect(statusOf("1.0.1", "14.0.14", ["1.0.0"])).toBe(
        AgentVersionStatus.Outdated,
      );
      expect(statusOf("14.0.10", "14.0.14", ["1.0.0"])).toBe(
        AgentVersionStatus.Outdated,
      );
    });

    test("an unparsable placeholder in the list matches nothing", () => {
      expect(statusOf("14.0.10", "14.0.14", ["not-a-version"])).toBe(
        AgentVersionStatus.Outdated,
      );
    });
  });
});
