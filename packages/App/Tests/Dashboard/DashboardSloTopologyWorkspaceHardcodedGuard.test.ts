import { describe, expect, test } from "@jest/globals";
import {
  getDefaultContext,
  getHardcodedStrings,
} from "../../FeatureSet/Dashboard/scripts/i18n/I18n";
import { HardcodedString } from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";

/*
 * The two-factor settings (authenticator apps, passkeys, security keys and
 * backup codes), the network topology, the status page's resources, the SLO
 * overview and the Slack, Microsoft Teams and Mattermost pages route every
 * sentence they show through translation (#6658). A German or Arabic reader
 * used to meet "Showing 12 of 40 devices", "Rolling 30 days", "Incident
 * Summary - Slack" and "Passkey added. Use it the next time you sign in."
 * in English, glued together from pieces no other language can read.
 *
 * `npm run i18n:hardcoded -- --dir Components/<name>` lists what is still
 * written as it is; this keeps those five directories at nothing, except the
 * one string below, and the Dashboard's other directories from S to W from
 * growing while they are routed in turn.
 *
 * Counted per file rather than quoted, so reformatting a file never fails
 * this; a new hard-coded string in any of these directories does.
 */

const DASHBOARD_SOURCE: string = "packages/App/FeatureSet/Dashboard/src/";

// The directories this change routed: nothing hard-coded is left in them.
const ROUTED: RegExp =
  /^Components\/(Slo|StatusPage|Topology|TwoFactorAuth|Workspace)\//;

// The directories the three parts of #6658 share out: S to W.
const S_TO_W: RegExp = /^Components\/[S-W]/;

const ALLOWED_IN_ROUTED: Record<string, { count: number; why: string }> = {
  "Components/Topology/Export/NetworkTopologyExportDocument.ts": {
    count: 1,
    why: "the exported PDF's document title (`Network topology - ${title}`): the PDF itself is written in English, so its title in the file's metadata is too",
  },
};

/*
 * The directories from S to W the next parts of #6658 route: each may only
 * shrink. A part that empties one moves it into ROUTED above.
 */
const STILL_BEING_ROUTED: Record<string, number> = {
  "Components/SecurityCase": 6,
  "Components/SecurityEvents": 224,
  "Components/SessionReplay": 108,
  "Components/Slack": 11,
  "Components/Team": 1,
  "Components/Telemetry": 35,
  "Components/TelemetryResource": 20,
  "Components/TracePipeline": 42,
  "Components/Traces": 21,
  "Components/User": 3,
  "Components/UserFlow": 34,
  "Components/UserTimezone": 1,
  "Components/Workflow": 5,
};

type RelativeFileFunction = (entry: HardcodedString) => string;

const relativeFile: RelativeFileFunction = (entry: HardcodedString): string => {
  return entry.file.startsWith(DASHBOARD_SOURCE)
    ? entry.file.slice(DASHBOARD_SOURCE.length)
    : entry.file;
};

let hardcoded: Array<HardcodedString> | null = null;

const getComponentsHardcoded: () => Array<HardcodedString> =
  (): Array<HardcodedString> => {
    if (!hardcoded) {
      hardcoded = getHardcodedStrings(getDefaultContext(), {
        directory: "Components",
      });
    }

    return hardcoded;
  };

describe("the two-factor, topology, status page, SLO and workspace components route their strings through translation", () => {
  test("only the reviewed PDF title is left in the five routed directories", () => {
    const counts: Record<string, number> = {};
    const found: Array<string> = [];

    for (const entry of getComponentsHardcoded()) {
      const file: string = relativeFile(entry);

      if (!ROUTED.test(file)) {
        continue;
      }

      counts[file] = (counts[file] || 0) + 1;
      found.push(`${file}:${entry.line} ${entry.reason} ${entry.text}`);
    }

    const unexpected: Array<string> = Object.keys(counts)
      .filter((file: string): boolean => {
        return counts[file]! > (ALLOWED_IN_ROUTED[file]?.count || 0);
      })
      .map((file: string): string => {
        return `${file}: ${counts[file]} (allowed ${ALLOWED_IN_ROUTED[file]?.count || 0}) - ${found
          .filter((line: string): boolean => {
            return line.startsWith(`${file}:`);
          })
          .join(" | ")}`;
      });

    expect(unexpected).toEqual([]);

    // Every exception is explained, and still needed.
    for (const file of Object.keys(ALLOWED_IN_ROUTED)) {
      expect(ALLOWED_IN_ROUTED[file]!.why.length).toBeGreaterThan(0);
      expect(counts[file] || 0).toBe(ALLOWED_IN_ROUTED[file]!.count);
    }
  }, 300000);

  test("the PDF title is the only string the topology export keeps in English", () => {
    const exportStrings: Array<HardcodedString> =
      getComponentsHardcoded().filter((entry: HardcodedString): boolean => {
        return relativeFile(entry).startsWith("Components/Topology/");
      });

    expect(
      exportStrings.map((entry: HardcodedString): string => {
        return entry.text;
      }),
    ).toEqual(["`Network topology - ${title}`"]);
  }, 300000);

  test("the directories from S to W still being routed do not grow", () => {
    const counts: Record<string, number> = {};

    for (const entry of getComponentsHardcoded()) {
      const file: string = relativeFile(entry);
      const directory: string = file.split("/").slice(0, 2).join("/");

      // The routed five answer to the first test.
      if (ROUTED.test(file) || !S_TO_W.test(directory)) {
        continue;
      }

      counts[directory] = (counts[directory] || 0) + 1;
    }

    const grown: Array<string> = Object.keys(counts)
      .filter((directory: string): boolean => {
        return counts[directory]! > (STILL_BEING_ROUTED[directory] || 0);
      })
      .map((directory: string): string => {
        return `${directory}: ${counts[directory]} (at most ${STILL_BEING_ROUTED[directory] || 0})`;
      });

    expect(grown).toEqual([]);
  }, 300000);
});
