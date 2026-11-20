import fs from "fs";
import path from "path";
import {
  GO_VERSION,
  KUBERNETES_MODULES,
  KUBERNETES_VERSION,
  MOVES_WITH_UPJET,
  REQUIREMENTS,
  UPJET_MODULE,
} from "./GoModule";

/*
 * Whether the Crossplane provider's pins are behind (#6616): the Go modules
 * its go.mod pins (GoModule.ts), and the tools its end-to-end test pins - the
 * Crossplane Helm chart (packages/E2E/Crossplane/e2e-tests/scripts/
 * run-tests.sh), the crossplane CLI and kind (.github/actions/
 * setup-crossplane-tools). Nothing else told anyone when they got old: the
 * pins sit in a TypeScript file and a shell script, which no update bot
 * reads.
 *
 * Behind means behind the newest release the set can take
 * (GoModule.ts's header says how the set is upgraded):
 *
 *   - Upjet: its newest v2 release;
 *   - what moves with it (MOVES_WITH_UPJET, the Kubernetes libraries): the
 *     newest patch release of the minor the newest Upjet's own go.mod
 *     requires, never a newer minor;
 *   - Go: that go.mod's go line;
 *   - every other module, the chart, the CLI and kind: their newest release.
 *
 * Pure: the releases are handed in (CheckPins.ts fetches them), so a test
 * can say what is behind for any set of releases.
 */

export const PINS_ISSUE_TITLE: string =
  "Crossplane provider: pinned dependencies are behind";

// The labels it is opened with: the ones #6616, which asked for it, has.
export const PINS_ISSUE_LABELS: Array<string> = ["follow-up", "enhancement"];

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..");
export const RUN_TESTS_SCRIPT: string =
  "packages/E2E/Crossplane/e2e-tests/scripts/run-tests.sh";
export const TOOLS_ACTION: string =
  ".github/actions/setup-crossplane-tools/action.yml";
export const GO_MODULE_FILE: string =
  "Scripts/CrossplaneProvider/Core/GoModule.ts";

export enum PinPolicy {
  Upjet = "upjet",
  MovesWithUpjet = "moves-with-upjet",
  Newest = "newest",
}

export interface ModulePin {
  module: string;
  version: string;
  policy: PinPolicy;
}

export interface ToolPins {
  // The Crossplane Helm chart the end-to-end test installs: 2.4.3.
  crossplaneChart: string;
  // The crossplane CLI and kind: v2.5.0, v0.33.0.
  crossplaneCli: string;
  kind: string;
}

export interface Pins {
  go: string;
  modules: Array<ModulePin>;
  tools: ToolPins;
}

// What the newest releases are, as CheckPins.ts finds them.
export interface Releases {
  // Every published version of each module (the Go proxy's @v/list).
  moduleVersions: Record<string, Array<string>>;
  // The newest version of each module (@latest): a pseudo-version included.
  moduleLatest: Record<string, string>;
  // The go.mod of the newest Upjet: its go line, and what it requires.
  upjetGoMod: { go: string; require: Record<string, string> };
  crossplaneChartVersions: Array<string>;
  crossplaneCliLatest: string;
  kindLatest: string;
}

export interface StalePin {
  name: string;
  pinned: string;
  newest: string;
  // Where it is pinned, for whoever upgrades it.
  where: string;
}

/*
 * The pins as the repository has them: GoModule.ts's, and the tools' read
 * from the files that pin them.
 */
export function readPins(root: string = REPOSITORY_ROOT): Pins {
  const runTests: string = fs.readFileSync(
    path.join(root, RUN_TESTS_SCRIPT),
    "utf8",
  );
  const action: string = fs.readFileSync(path.join(root, TOOLS_ACTION), "utf8");

  return {
    go: GO_VERSION,
    modules: [
      ...Object.keys(REQUIREMENTS)
        .sort()
        .map((module: string): ModulePin => {
          return {
            module,
            version: REQUIREMENTS[module] as string,
            policy:
              module === UPJET_MODULE
                ? PinPolicy.Upjet
                : MOVES_WITH_UPJET.includes(module)
                  ? PinPolicy.MovesWithUpjet
                  : PinPolicy.Newest,
          };
        }),
      ...KUBERNETES_MODULES.map((module: string): ModulePin => {
        return {
          module,
          version: KUBERNETES_VERSION,
          policy: PinPolicy.MovesWithUpjet,
        };
      }),
    ],
    tools: parseToolPins(runTests, action),
  };
}

function matchOne(source: string, pattern: RegExp, what: string): string {
  const match: RegExpMatchArray | null = source.match(pattern);

  if (!match) {
    throw new Error(`No pin for ${what} found.`);
  }

  return match[1] as string;
}

export function parseToolPins(runTests: string, action: string): ToolPins {
  return {
    crossplaneChart: matchOne(
      runTests,
      /CROSSPLANE_E2E_CROSSPLANE_VERSION:-([0-9][^}"]*)\}/,
      "the Crossplane chart",
    ),
    crossplaneCli: matchOne(
      action,
      /crossplane_version="(v[0-9][^"]*)"/,
      "the crossplane CLI",
    ),
    kind: matchOne(action, /kind_version="(v[0-9][^"]*)"/, "kind"),
  };
}

interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string;
}

// v1.2.3, 1.2.3 or a pseudo-version (v0.0.0-20260719180100-659f1dc036c5).
export function parseSemVer(version: string): SemVer | null {
  const match: RegExpMatchArray | null = version
    .trim()
    .match(
      /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/,
    );

  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || "",
  };
}

// A pseudo-version's timestamp, which orders them: 20260719180100.
function pseudoTime(prerelease: string): string | null {
  const match: RegExpMatchArray | null = prerelease.match(
    /(?:^|\.)(\d{14})-[0-9a-f]{12}$/,
  );

  return match ? (match[1] as string) : null;
}

// Negative when a is older than b, by semantic version (a pseudo-version by its time).
export function compareVersions(a: string, b: string): number {
  const left: SemVer | null = parseSemVer(a);
  const right: SemVer | null = parseSemVer(b);

  if (!left || !right) {
    return a.localeCompare(b);
  }

  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) {
      return left[key] - right[key];
    }
  }

  const leftTime: string | null = pseudoTime(left.prerelease);
  const rightTime: string | null = pseudoTime(right.prerelease);

  if (leftTime && rightTime) {
    return leftTime.localeCompare(rightTime);
  }

  // A release comes after its prereleases.
  if (left.prerelease === right.prerelease) {
    return 0;
  }

  if (!left.prerelease) {
    return 1;
  }

  if (!right.prerelease) {
    return -1;
  }

  return left.prerelease.localeCompare(right.prerelease);
}

function isRelease(version: string): boolean {
  const parsed: SemVer | null = parseSemVer(version);

  return Boolean(parsed && !parsed.prerelease);
}

// The newest release of a list, or null when it has none.
export function newestRelease(
  versions: Array<string>,
  filter: (version: SemVer) => boolean = (): boolean => {
    return true;
  },
): string | null {
  const releases: Array<string> = versions.filter(
    (version: string): boolean => {
      const parsed: SemVer | null = parseSemVer(version);
      return Boolean(parsed && !parsed.prerelease && filter(parsed));
    },
  );

  if (releases.length === 0) {
    return null;
  }

  return releases.sort(compareVersions)[releases.length - 1] as string;
}

/*
 * The minor a module moves with: the one the newest Upjet requires, else -
 * for a module Upjet does not name - the pinned one.
 */
function targetMinor(
  pin: ModulePin,
  releases: Releases,
): { major: number; minor: number } {
  const required: string | undefined =
    releases.upjetGoMod.require[pin.module] ||
    // The Kubernetes libraries move together, with k8s.io/api.
    (KUBERNETES_MODULES.includes(pin.module)
      ? releases.upjetGoMod.require["k8s.io/api"]
      : undefined);
  const parsed: SemVer | null = parseSemVer(required || pin.version);

  return { major: parsed?.major || 0, minor: parsed?.minor || 0 };
}

function newestFor(pin: ModulePin, releases: Releases): string | null {
  const versions: Array<string> = releases.moduleVersions[pin.module] || [];
  const pinned: SemVer | null = parseSemVer(pin.version);

  switch (pin.policy) {
    case PinPolicy.Upjet:
      return newestRelease(versions, (version: SemVer): boolean => {
        return version.major === (pinned?.major ?? version.major);
      });
    case PinPolicy.MovesWithUpjet: {
      const { major, minor } = targetMinor(pin, releases);
      return newestRelease(versions, (version: SemVer): boolean => {
        return version.major === major && version.minor === minor;
      });
    }
    case PinPolicy.Newest: {
      // A pseudo-version's newest is the module's @latest.
      if (pinned?.prerelease && pseudoTime(pinned.prerelease)) {
        return releases.moduleLatest[pin.module] || null;
      }

      return (
        newestRelease(versions, (version: SemVer): boolean => {
          return version.major === (pinned?.major ?? version.major);
        }) ||
        releases.moduleLatest[pin.module] ||
        null
      );
    }
  }
}

function behind(
  name: string,
  pinned: string,
  newest: string | null,
  where: string,
): Array<StalePin> {
  if (!newest || compareVersions(pinned, newest) >= 0) {
    return [];
  }

  return [{ name, pinned, newest, where }];
}

// Every pin that is behind; empty when every one is current.
export function findStalePins(pins: Pins, releases: Releases): Array<StalePin> {
  const stale: Array<StalePin> = [];

  for (const pin of pins.modules) {
    stale.push(
      ...behind(
        pin.module,
        pin.version,
        newestFor(pin, releases),
        pin.policy === PinPolicy.MovesWithUpjet
          ? `${GO_MODULE_FILE} (moves with Upjet)`
          : GO_MODULE_FILE,
      ),
    );
  }

  stale.push(
    ...behind(
      "Go",
      pins.go,
      releases.upjetGoMod.go && isRelease(releases.upjetGoMod.go)
        ? releases.upjetGoMod.go
        : null,
      `${GO_MODULE_FILE} (GO_VERSION, Upjet's go line)`,
    ),
    ...behind(
      "Crossplane Helm chart (end-to-end test)",
      pins.tools.crossplaneChart,
      newestRelease(releases.crossplaneChartVersions),
      RUN_TESTS_SCRIPT,
    ),
    ...behind(
      "crossplane CLI",
      pins.tools.crossplaneCli,
      isRelease(releases.crossplaneCliLatest)
        ? releases.crossplaneCliLatest
        : null,
      TOOLS_ACTION,
    ),
    ...behind(
      "kind",
      pins.tools.kind,
      isRelease(releases.kindLatest) ? releases.kindLatest : null,
      TOOLS_ACTION,
    ),
  );

  return stale;
}

/*
 * A go.mod's go line and what it requires, direct and indirect: the
 * newest Upjet's, which decides what moves with it.
 */
export function parseGoMod(text: string): {
  go: string;
  require: Record<string, string>;
} {
  const require: Record<string, string> = {};
  let inBlock: boolean = false;
  let go: string = "";

  for (const rawLine of text.split("\n")) {
    const line: string = rawLine.replace(/\/\/.*$/, "").trim();

    if (!line) {
      continue;
    }

    const goLine: RegExpMatchArray | null = line.match(/^go\s+(\S+)$/);

    if (goLine) {
      go = goLine[1] as string;
      continue;
    }

    if (line === "require (") {
      inBlock = true;
      continue;
    }

    if (inBlock && line === ")") {
      inBlock = false;
      continue;
    }

    const requirement: RegExpMatchArray | null = (
      inBlock ? line : line.replace(/^require\s+/, "")
    ).match(/^(\S+)\s+(v\S+)$/);

    if (requirement && (inBlock || line.startsWith("require "))) {
      require[requirement[1] as string] = requirement[2] as string;
    }
  }

  return { go, require };
}

// The issue's text: what is behind, and how to upgrade it.
export function renderPinsIssue(
  stale: Array<StalePin>,
  runUrl?: string,
): string {
  return [
    "The Crossplane provider's pinned Go modules and the tools its end-to-end test pins have newer compatible releases than the repository pins. Security fixes in them reach the provider only once someone moves the pins (#6616).",
    "",
    "| What | Pinned | Newest | Where |",
    "| --- | --- | --- | --- |",
    ...stale.map((pin: StalePin): string => {
      return `| \`${pin.name}\` | ${pin.pinned} | ${pin.newest} | \`${pin.where}\` |`;
    }),
    "",
    "## How to upgrade",
    "",
    `\`${GO_MODULE_FILE}\`'s header says how the Go modules move: Upjet first, then what its own go.mod requires, each at the newest patch of the minor it names. Then generate both providers, run \`go test ./...\` in \`Crossplane/provider-oneuptime\`, build and check the package for both platforms (\`build-package.sh\`, \`check-package.sh --run\`), and run the end-to-end test (\`packages/E2E/Crossplane\`), which the Crossplane Provider workflow runs on the pull request.`,
    "",
    "`npm run check-crossplane-provider-pins` lists what is behind from a checkout. This issue is kept by the Crossplane Provider Pins workflow: it is rewritten every week while something is behind, and closed once nothing is.",
    ...(runUrl ? ["", `Checked by ${runUrl}.`] : []),
    "",
  ].join("\n");
}

export type IssueAction = "create" | "update" | "close" | "nothing";

// What the weekly run does with the one issue, from what it found.
export function pinsIssueAction(
  openIssue: number | null,
  stale: Array<StalePin>,
): IssueAction {
  if (stale.length > 0) {
    return openIssue === null ? "create" : "update";
  }

  return openIssue === null ? "nothing" : "close";
}
