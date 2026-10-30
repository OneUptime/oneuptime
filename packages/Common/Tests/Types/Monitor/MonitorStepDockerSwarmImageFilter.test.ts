import { describe, expect, test } from "@jest/globals";
import { MonitorStepDockerSwarmMonitorUtil } from "../../../Types/Monitor/MonitorStepDockerSwarmMonitor";
import Wildcard from "../../../Types/BaseDatabase/Wildcard";
import { escapeRegExp } from "../../../Utils/RegExpEscape";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { generatedTexts } from "../../Helpers/GeneratedTexts";

/*
 * A Docker Swarm monitor's Container Image filter, against the image a
 * Swarm task really runs.
 *
 * The bug: the worker matched `resource.container.image.name` exactly, but
 * Swarm rewrites the image a service is deployed with before a task runs
 * it - `docker service create nginx` tags it `:latest` and pins it to the
 * digest the registry resolves (`nginx:latest@sha256:…`), and docker_stats
 * reports that. So `nginx:latest`, the image as `docker service ls` and
 * OneUptime's Services and Tasks pages show it (and the docs' example),
 * matched no task at all.
 *
 * The filter is now a Wildcard of globs, compiled by the analytics query to
 * ILIKE patterns (Wildcard.toPatterns). These tests run those very patterns,
 * with ILIKE's own rules, against the values a task can carry.
 */

const DIGEST_A: string =
  "sha256:4c0fdaa8b6341bfdeca5f18f7837462c80cff90527ee35ef185571e1c327beac";
const DIGEST_B: string =
  "sha256:0d17b565c37bcbd895e9d92315a05c1c3c9a29f762b011a10c54a66cd53c9b31";

/*
 * ClickHouse's ILIKE: `%` is any run of characters, `_` any one, a
 * backslash takes the next character as itself; case is ignored.
 */
function ilikeMatches(pattern: string, value: string): boolean {
  let source: string = "";

  for (let index: number = 0; index < pattern.length; index++) {
    const character: string = pattern[index]!;

    if (character === "\\" && index + 1 < pattern.length) {
      source += escapeRegExp(pattern[index + 1]!);
      index++;
    } else if (character === "%") {
      source += "[\\s\\S]*";
    } else if (character === "_") {
      source += "[\\s\\S]";
    } else {
      source += escapeRegExp(character);
    }
  }

  return new RegExp(`^${source}$`, "i").test(value);
}

// Whether a typed Container Image matches a stored resource.container.image.name.
function filterMatches(typed: string, stored: string): boolean {
  const globs: Array<string> =
    MonitorStepDockerSwarmMonitorUtil.getContainerImageGlobs(typed);

  return new Wildcard<string>(globs)
    .toPatterns()
    .some((pattern: string): boolean => {
      return ilikeMatches(pattern, stored);
    });
}

describe("a Swarm monitor's Container Image matches the image a task runs", () => {
  test("nginx:latest, as the docs and the Services page write it, matches the digest-pinned image Swarm runs", () => {
    expect(filterMatches("nginx:latest", `nginx:latest@${DIGEST_A}`)).toBe(
      true,
    );
    // A service deployed with --no-resolve-image runs it unpinned.
    expect(filterMatches("nginx:latest", "nginx:latest")).toBe(true);
  });

  test("it does not match a longer tag, another tag or another image", () => {
    for (const stored of [
      `nginx:latest-alpine@${DIGEST_A}`,
      "nginx:latest2",
      `nginx:1.27@${DIGEST_A}`,
      `mynginx:latest@${DIGEST_A}`,
      `registry.example.com/nginx:latest@${DIGEST_A}`,
    ]) {
      expect({
        stored,
        matches: filterMatches("nginx:latest", stored),
      }).toEqual({ stored, matches: false });
    }
  });

  test("a digest typed with the image is left out, so an update to a new digest still matches", () => {
    expect(
      filterMatches(`nginx:1.27@${DIGEST_A}`, `nginx:1.27@${DIGEST_B}`),
    ).toBe(true);
    expect(filterMatches(`nginx:1.27@${DIGEST_A}`, "nginx:1.27")).toBe(true);
    expect(
      filterMatches(`nginx:1.27@${DIGEST_A}`, `nginx:1.28@${DIGEST_A}`),
    ).toBe(false);
  });

  test("a name without a tag is read as :latest, the tag Swarm gives it", () => {
    expect(filterMatches("nginx", `nginx:latest@${DIGEST_A}`)).toBe(true);
    expect(filterMatches("nginx", "nginx")).toBe(true);
    expect(filterMatches("nginx", `nginx@${DIGEST_A}`)).toBe(true);
    expect(filterMatches("nginx", `nginx:1.27@${DIGEST_A}`)).toBe(false);

    expect(
      MonitorStepDockerSwarmMonitorUtil.getContainerImageGlobs("nginx"),
    ).toEqual(["nginx", "nginx@*", "nginx:latest", "nginx:latest@*"]);
  });

  test("an image pinned by digest alone keeps no tag: it is not read as :latest", () => {
    expect(
      MonitorStepDockerSwarmMonitorUtil.getContainerImageGlobs(
        `nginx@${DIGEST_A}`,
      ),
    ).toEqual(["nginx", "nginx@*"]);
    expect(filterMatches(`nginx@${DIGEST_A}`, `nginx@${DIGEST_B}`)).toBe(true);
    expect(filterMatches(`nginx@${DIGEST_A}`, `nginx:latest@${DIGEST_A}`)).toBe(
      false,
    );
  });

  test("a registry's port is not a tag", () => {
    const typed: string = "registry.example.com:5000/team/app";

    expect(
      filterMatches(
        typed,
        `registry.example.com:5000/team/app:latest@${DIGEST_A}`,
      ),
    ).toBe(true);
    expect(
      filterMatches(
        "registry.example.com:5000/team/app:2.1",
        `registry.example.com:5000/team/app:2.1@${DIGEST_A}`,
      ),
    ).toBe(true);
    expect(
      filterMatches(
        typed,
        `registry.example.com:5000/team/app:2.1@${DIGEST_A}`,
      ),
    ).toBe(false);
  });

  test("what is typed matches as itself: no glob or LIKE wildcard in it widens the filter", () => {
    // `_` is any one character to ILIKE, `*` and `?` are globs to Wildcard.
    expect(filterMatches("team/my_app:1", `team/myXapp:1@${DIGEST_A}`)).toBe(
      false,
    );
    expect(filterMatches("team/my_app:1", `team/my_app:1@${DIGEST_A}`)).toBe(
      true,
    );
    expect(filterMatches("ngin*:latest", `nginx:latest@${DIGEST_A}`)).toBe(
      false,
    );
    expect(filterMatches("ngin?:latest", `nginx:latest@${DIGEST_A}`)).toBe(
      false,
    );
    expect(filterMatches("100%:latest", `100x:latest@${DIGEST_A}`)).toBe(false);
  });

  test("surrounding blanks are ignored, and blank text is no filter at all", () => {
    expect(filterMatches("  nginx:latest ", `nginx:latest@${DIGEST_A}`)).toBe(
      true,
    );
    expect(
      MonitorStepDockerSwarmMonitorUtil.getContainerImageGlobs("   "),
    ).toEqual([]);
  });

  test("a digest with no name before it is matched as it is written", () => {
    expect(
      MonitorStepDockerSwarmMonitorUtil.getContainerImageGlobs(`@${DIGEST_A}`),
    ).toEqual([`@${DIGEST_A}`]);
  });

  test("a value of megabytes is read in one pass, without a regular expression", () => {
    const huge: string = `${"a:b@".repeat(750000)}nginx`;
    // The fastest of up to three reads counts (FastestRun): one is noisy.
    const read: FastestRun<Array<string>> = fastestRun({
      run: (): Array<string> => {
        return MonitorStepDockerSwarmMonitorUtil.getContainerImageGlobs(huge);
      },
      limitInMs: 2000,
    });

    expect(read.result).toHaveLength(2);
    expect(read.inMs).toBeLessThan(2000);
  });
});

/*
 * Every tagged image of many shapes - registries with ports, nested
 * repositories, `.`, `-` and `_` in names and tags - matches each digest a
 * task could be pinned to, typed with or without a digest of its own, and
 * never matches the same image under a longer tag.
 */
describe("Container Image over generated image references", () => {
  const NAME_PIECES: ReadonlyArray<string> = [
    "a",
    "b",
    "x9",
    "-",
    "_",
    ".",
    "/",
    "web",
    "api",
  ];
  const TAG_PIECES: ReadonlyArray<string> = [
    "1",
    "2",
    ".",
    "-",
    "_",
    "rc",
    "v",
  ];
  const HEX: string = "0123456789abcdef";

  const random: SeededRandom = seededRandom(5404);

  function digest(): string {
    let hex: string = "";

    for (let index: number = 0; index < 64; index++) {
      hex += HEX[random(HEX.length)];
    }

    return `sha256:${hex}`;
  }

  const names: Array<string> = generatedTexts(400, 7186, NAME_PIECES, 8)
    .map((piece: string): string => {
      // A repository name starts and ends with a letter or a digit.
      return `n${piece}n`.replace(/\/+/g, "/");
    })
    .filter((name: string): boolean => {
      return !name.includes(":") && !name.includes("@");
    });
  const tags: Array<string> = generatedTexts(names.length, 9311, TAG_PIECES, 6);

  test("each one matches its pinned self, and not a longer tag", () => {
    expect(names.length).toBeGreaterThan(300);

    names.forEach((name: string, index: number): void => {
      const tag: string = `t${tags[index]}`;
      const image: string = `${name}:${tag}`;
      const pinned: string = `${image}@${digest()}`;
      const typedWithDigest: string = `${image}@${digest()}`;
      const longerTag: string = `${image}x@${digest()}`;

      expect({
        image,
        pinned,
        bare: filterMatches(image, pinned),
        typedWithDigest: filterMatches(typedWithDigest, pinned),
        longerTag: filterMatches(image, longerTag),
      }).toEqual({
        image,
        pinned,
        bare: true,
        typedWithDigest: true,
        longerTag: false,
      });
    });
  });
});
