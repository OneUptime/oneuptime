import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MonitorStepExternalStatusPageMonitorUtil } from "../../../Types/Monitor/MonitorStepExternalStatusPageMonitor";

/*
 * The Terraform provider describes each monitor type's raw JSON escape hatch
 * by the keys that JSON takes (Scripts/TerraformProvider/StaticFiles/
 * monitorsteps.go, subDescriptions). The External Status Page monitor's
 * named "(statusPageUrl, providerType)": there is no providerType - the key
 * is provider - and it left out the components a monitor watches since
 * #5156 (componentNames). Someone writing the JSON from that description
 * wrote a key the server ignores and watched the whole page.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");

const MONITOR_STEPS_GO: string = fs.readFileSync(
  path.join(REPO_ROOT, "Scripts/TerraformProvider/StaticFiles/monitorsteps.go"),
  "utf8",
);

const DESCRIPTION_LINE: RegExp = /"external_status_page_monitor":\s*"([^"]*)",/;
const NAMED_KEYS: RegExp = /\(([^()]*)\)\.?$/;

function describedKeys(): Array<string> {
  const line: RegExpMatchArray | null =
    MONITOR_STEPS_GO.match(DESCRIPTION_LINE);

  if (!line) {
    throw new Error(
      "monitorsteps.go has no description for external_status_page_monitor",
    );
  }

  const named: RegExpMatchArray | null = (line[1] as string).match(NAMED_KEYS);

  if (!named) {
    throw new Error("the description names no keys in brackets");
  }

  return (named[1] as string).split(",").map((key: string): string => {
    return key.trim();
  });
}

describe("the Terraform provider's External Status Page monitor JSON", () => {
  test("names only keys the monitor step's JSON has", () => {
    const keys: Array<string> = Object.keys(
      MonitorStepExternalStatusPageMonitorUtil.toJSON(
        MonitorStepExternalStatusPageMonitorUtil.getDefault(),
      ),
    );

    for (const key of describedKeys()) {
      expect({ key, isAKey: keys.includes(key) }).toEqual({
        key,
        isAKey: true,
      });
    }
  });

  test("names the provider and the components the monitor watches", () => {
    expect(describedKeys()).toEqual(
      expect.arrayContaining([
        "statusPageUrl",
        "provider",
        "componentGroupName",
        "componentNames",
      ]),
    );
  });

  test("does not name the old single component filter or a provider type", () => {
    expect(describedKeys()).not.toContain("providerType");
    expect(describedKeys()).not.toContain("componentName");
  });

  test("a JSON written from the description is read back as written", () => {
    const written: Record<string, unknown> = {
      statusPageUrl: "https://www.githubstatus.com",
      provider: "Atlassian Statuspage",
      componentGroupName: "Core",
      componentNames: ["Git Operations", "Pull Requests"],
    };

    const read: Record<string, unknown> =
      MonitorStepExternalStatusPageMonitorUtil.toJSON(
        MonitorStepExternalStatusPageMonitorUtil.fromJSON(
          written as Parameters<
            typeof MonitorStepExternalStatusPageMonitorUtil.fromJSON
          >[0],
        ),
      ) as Record<string, unknown>;

    for (const key of describedKeys()) {
      expect({ key, value: read[key] }).toEqual({ key, value: written[key] });
    }
  });
});
