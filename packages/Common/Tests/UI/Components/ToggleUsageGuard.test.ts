import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { listScanRoots, listSourceFiles } from "../../ForeignHiddenRuleGuard";
import {
  HandRolledSwitch,
  scanToggleUsage,
  ToggleScanResult,
  ToggleUnderFieldLabel,
  ToggleUse,
} from "../../Helpers/ToggleUsageScan";

/*
 * One switch, everywhere. See Tests/Helpers/ToggleUsageScan.ts for what is
 * read and why.
 */

const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

function relative(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

/*
 * The controls that carry role="switch" without being the shared Toggle,
 * each on purpose. A new one fails the guard until it is either the Toggle
 * or listed here with a reason.
 */
const HAND_ROLLED_SWITCHES: Record<string, string> = {
  "packages/Common/UI/Components/Toggle/Toggle.tsx": "The switch itself.",
  "packages/App/FeatureSet/Dashboard/src/Pages/UserSettings/NotificationSettings.tsx":
    "A round on/off cell in the per-event channel matrix, one per channel per event: a grid of ticks, not a switch beside a sentence.",
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteGeoMap.tsx":
    "Rows of the map's layer menu, drawn as checkbox rows the way a menu of options is.",
  "packages/App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayUi.tsx":
    "Skip idle, a whole transport-row chip at the player chrome's 32px scale; its small track is drawn the Toggle's way (the Toggle's grey and indigo fills, the same white knob) and takes its dark colours from the same Theme.css rules.",
};

interface ProjectScan {
  files: Array<string>;
  result: ToggleScanResult;
}

let cachedScan: ProjectScan | null = null;

function scanProject(): ProjectScan {
  if (cachedScan) {
    return cachedScan;
  }

  const files: Array<string> = listScanRoots(REPOSITORY_ROOT)
    .flatMap(listSourceFiles)
    .filter((file: string): boolean => {
      return file.endsWith(".tsx");
    });

  const result: ToggleScanResult = {
    toggles: [],
    togglesUnderFieldLabel: [],
    handRolledSwitches: [],
  };

  for (const file of files) {
    const scanned: ToggleScanResult = scanToggleUsage(
      relative(file),
      fs.readFileSync(file, "utf8"),
    );

    result.toggles.push(...scanned.toggles);
    result.togglesUnderFieldLabel.push(...scanned.togglesUnderFieldLabel);
    result.handRolledSwitches.push(...scanned.handRolledSwitches);
  }

  cachedScan = { files, result };

  return cachedScan;
}

describe("the detector", () => {
  const IMPORTS: string = [
    'import React from "react";',
    'import Toggle from "Common/UI/Components/Toggle/Toggle";',
    'import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";',
  ].join("\n");

  function scan(jsx: string): ToggleScanResult {
    return scanToggleUsage(
      "Example.tsx",
      `${IMPORTS}\nexport const X = () => (\n${jsx}\n);\n`,
    );
  }

  test("a switch with no name is flagged", () => {
    const result: ToggleScanResult = scan(
      "<Toggle value={on} onChange={setOn} />",
    );

    expect(result.toggles).toHaveLength(1);
    expect(result.toggles[0]!.isNamed).toBe(false);
  });

  test.each([
    '<Toggle title="Secret" value={on} onChange={setOn} />',
    "<Toggle title={translated} value={on} onChange={setOn} />",
    '<Toggle ariaLabel="Is root" value={on} onChange={setOn} />',
    "<Toggle ariaLabelledby={labelId} value={on} onChange={setOn} />",
  ])("a named switch passes: %s", (jsx: string) => {
    expect(scan(jsx).toggles[0]!.isNamed).toBe(true);
  });

  test.each([
    '<Toggle title="" value={on} onChange={setOn} />',
    "<Toggle title={undefined} value={on} onChange={setOn} />",
  ])("an empty name is no name: %s", (jsx: string) => {
    expect(scan(jsx).toggles[0]!.isNamed).toBe(false);
  });

  test("an id names the switch only when a label points at it", () => {
    expect(
      scan(
        "<div><Toggle id={switchId} value={on} onChange={setOn} /><label htmlFor={switchId}>Read-only</label></div>",
      ).toggles[0]!.isNamed,
    ).toBe(true);
    expect(
      scan(
        "<div><Toggle id={switchId} value={on} onChange={setOn} /><label htmlFor={otherId}>Read-only</label></div>",
      ).toggles[0]!.isNamed,
    ).toBe(false);
  });

  test("the switch under its own FieldLabel - the screenshot's layout - is flagged", () => {
    const result: ToggleScanResult = scan(
      [
        "<div>",
        '  <FieldLabelElement title="Check Nameserver Consistency" description="Query each nameserver." />',
        '  <Toggle title="Check Nameserver Consistency" value={on} onChange={setOn} />',
        "</div>",
      ].join("\n"),
    );

    expect(result.togglesUnderFieldLabel).toHaveLength(1);
  });

  test("a FieldLabel over another control, or a switch on its own, is fine", () => {
    expect(
      scan(
        '<div><FieldLabelElement title="Name" /><input /><Toggle title="On" value={on} onChange={setOn} /></div>',
      ).togglesUnderFieldLabel,
    ).toEqual([]);
    expect(
      scan('<div><Toggle title="On" value={on} onChange={setOn} /></div>')
        .togglesUnderFieldLabel,
    ).toEqual([]);
  });

  test("role=switch on a plain element is a hand-rolled switch; the word in prose is not", () => {
    const result: ToggleScanResult = scan(
      [
        "<div>",
        '  <button type="button" role="switch" aria-checked={on} />',
        '  {/* a role="switch" in a comment */}',
        "  <span title='role=\"switch\"'>text</span>",
        "</div>",
      ].join("\n"),
    );

    expect(
      result.handRolledSwitches.map((found: HandRolledSwitch): string => {
        return found.tagName;
      }),
    ).toEqual(["button"]);
  });

  test("a component that happens to be called Toggle, not imported from the switch, is not read", () => {
    const result: ToggleScanResult = scanToggleUsage(
      "Other.tsx",
      'import Toggle from "./MyOwnToggle";\nexport const X = () => <Toggle />;\n',
    );

    expect(result.toggles).toEqual([]);
  });
});

describe("every switch in the product", () => {
  test("the scan reads the product, so a pass is not vacuous", () => {
    const { result } = scanProject();
    const filesWithToggles: Set<string> = new Set(
      result.toggles.map((use: ToggleUse): string => {
        return use.file;
      }),
    );

    expect(result.toggles.length).toBeGreaterThanOrEqual(30);
    expect(Array.from(filesWithToggles)).toEqual(
      expect.arrayContaining([
        // Every Toggle field of every form goes through this one.
        "packages/Common/UI/Components/Forms/Fields/FormField.tsx",
        "packages/App/FeatureSet/Dashboard/src/Components/EmailPreferences/EmailRollupCard.tsx",
        "packages/App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteriaInstance.tsx",
      ]),
    );
  });

  test("has a name a screen reader can say", () => {
    const unnamed: Array<string> = scanProject()
      .result.toggles.filter((use: ToggleUse): boolean => {
        return !use.isNamed;
      })
      .map((use: ToggleUse): string => {
        return `${use.file}:${use.line} (${use.attributes.join(", ")}) - give it a title, or an ariaLabel where the words are elsewhere`;
      });

    expect(unnamed).toEqual([]);
  });

  test("draws its own label beside it, never sits under a separate FieldLabel", () => {
    const stacked: Array<string> =
      scanProject().result.togglesUnderFieldLabel.map(
        (found: ToggleUnderFieldLabel): string => {
          return `${found.file}:${found.line} - pass the FieldLabel's title and description to the Toggle instead`;
        },
      );

    expect(stacked).toEqual([]);
  });

  test("is the shared Toggle, except where a list here says why not", () => {
    const files: Array<string> = Array.from(
      new Set(
        scanProject().result.handRolledSwitches.map(
          (found: HandRolledSwitch): string => {
            return found.file;
          },
        ),
      ),
    ).sort();

    const unlisted: Array<string> = files.filter((file: string): boolean => {
      return !HAND_ROLLED_SWITCHES[file];
    });

    expect(unlisted).toEqual([]);
  });

  /*
   * A listed file that no longer draws a switch of its own is dropped from
   * the list, so the list cannot quietly wave a new one through later.
   * ee/ is not in every checkout; the list has no ee/ entries.
   */
  test("lists no file that has stopped drawing its own switch", () => {
    const files: Set<string> = new Set(
      scanProject().result.handRolledSwitches.map(
        (found: HandRolledSwitch): string => {
          return found.file;
        },
      ),
    );

    const stale: Array<string> = Object.keys(HAND_ROLLED_SWITCHES).filter(
      (file: string): boolean => {
        return !files.has(file);
      },
    );

    expect(stale).toEqual([]);
  });
});
