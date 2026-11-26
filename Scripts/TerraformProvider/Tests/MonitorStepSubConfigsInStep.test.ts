import fs from "fs";
import path from "path";
import { MONITOR_STEP_SUB_CONFIGS } from "Common/Utils/DeveloperDocs/TerraformMonitorSteps";
import MonitorStepRollingTime from "Common/Types/Monitor/MonitorStepRollingTime";
import { MonitorStepType } from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { DocumentationGenerator } from "../Core/DocumentationGenerator";

/*
 * THE PROVIDER'S PER-MONITOR-TYPE STEP ATTRIBUTES ARE THE SERVER'S.
 *
 * A monitor step keeps each infrastructure monitor's settings in a sub-config
 * of its own (`xcpNgMonitor`, `vmwareMonitor`, ...), and the provider keeps
 * each in a raw-JSON attribute (monitorsteps.go monitorStepsSubConfigs), with
 * a rolling time it reads as the server does (monitorstepsvalues.go
 * monitorStepsRollingTimeSettings). The Dashboard's Terraform export writes
 * the same attributes (Common/Utils/DeveloperDocs/TerraformMonitorSteps). A
 * monitor type added to one and not the others is a monitor Terraform
 * silently drops: its settings are no attribute, so a plan removes them.
 *
 * The Go suites hold the Go lists to the cases the generator writes; this
 * holds the Go source itself to Common, with no Go toolchain needed.
 */

const STATIC_FILES: string = path.join(__dirname, "..", "StaticFiles");

const MONITOR_STEPS_GO: string = fs.readFileSync(
  path.join(STATIC_FILES, "monitorsteps.go"),
  "utf8",
);
const MONITOR_STEPS_VALUES_GO: string = fs.readFileSync(
  path.join(STATIC_FILES, "monitorstepsvalues.go"),
  "utf8",
);

// The body of a Go `var name = []T{ ... }` or `name := map[...]...{ ... }`.
function goBlock(source: string, opening: string): string {
  const start: number = source.indexOf(opening);

  if (start < 0) {
    throw new Error(`"${opening}" not found`);
  }

  const end: number = source.indexOf("\n}", start);

  return source.slice(start + opening.length, end);
}

function goPairs(block: string): Array<[string, string]> {
  return Array.from(block.matchAll(/\{"([^"]+)", "([^"]+)"\}/g)).map(
    (match: RegExpMatchArray): [string, string] => {
      return [match[1] as string, match[2] as string];
    },
  );
}

const SUB_CONFIGS: Array<[string, string]> = goPairs(
  goBlock(
    MONITOR_STEPS_GO,
    "var monitorStepsSubConfigs = []monitorStepsSubConfig{",
  ),
);

/*
 * A list of an anonymous struct: its values follow the struct's fields,
 * after `}{`.
 */
const ROLLING_TIME_SETTINGS: Array<[string, string]> = goPairs(
  goBlock(
    MONITOR_STEPS_VALUES_GO.slice(
      MONITOR_STEPS_VALUES_GO.indexOf(
        "var monitorStepsRollingTimeSettings = []struct {",
      ),
    ),
    "}{",
  ),
);

const SUB_DESCRIPTIONS: string = goBlock(
  MONITOR_STEPS_GO,
  "subDescriptions := map[string]string{",
);

describe("the provider's step sub-configs", () => {
  test("are the ones the Dashboard's Terraform export writes, in its order", () => {
    expect(SUB_CONFIGS).toEqual(
      MONITOR_STEP_SUB_CONFIGS.map(
        (config: { attributeName: string; apiKey: string }) => {
          return [config.attributeName, config.apiKey];
        },
      ),
    );
  });

  test("each has a description, and each description belongs to one", () => {
    const described: Array<string> = Array.from(
      SUB_DESCRIPTIONS.matchAll(/^\s*"([a-z_]+)":\s+"/gm),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect([...described].sort()).toEqual(
      SUB_CONFIGS.map(([name]: [string, string]): string => {
        return name;
      }).sort(),
    );
  });

  test("an attribute is its API key in snake case", () => {
    for (const [attribute, apiKey] of SUB_CONFIGS) {
      expect(attribute).toBe(
        apiKey.replace(/[A-Z]/g, (letter: string): string => {
          return `_${letter.toLowerCase()}`;
        }),
      );
    }
  });

  test("every step setting that keeps a rolling time is a sub-config, read for the server's monitor type", () => {
    expect(
      ROLLING_TIME_SETTINGS.map(([apiKey, monitorType]: [string, string]) => {
        return `${monitorType}=${apiKey}`;
      }).sort(),
    ).toEqual(
      MonitorStepRollingTime.getMonitorTypes()
        .map((monitorType: MonitorType): string => {
          return `${monitorType}=${MonitorStepRollingTime.getStepKey(monitorType)}`;
        })
        .sort(),
    );

    const apiKeys: Array<string> = SUB_CONFIGS.map(
      ([, apiKey]: [string, string]): string => {
        return apiKey;
      },
    );

    for (const [apiKey] of ROLLING_TIME_SETTINGS) {
      expect(apiKeys).toContain(apiKey);
    }
  });
});

describe("an XCP-ng monitor's step", () => {
  // A key the step's type declares: this fails to compile if it is renamed.
  const XCP_NG_KEY: keyof MonitorStepType = "xcpNgMonitor";

  test("is the xcp_ng_monitor attribute, right after VMware's", () => {
    expect(SUB_CONFIGS).toContainEqual(["xcp_ng_monitor", XCP_NG_KEY]);

    const names: Array<string> = SUB_CONFIGS.map(
      ([name]: [string, string]): string => {
        return name;
      },
    );

    expect(names.indexOf("xcp_ng_monitor")).toBe(
      names.indexOf("vmware_monitor") + 1,
    );
  });

  test("says what it holds: the pool's UUID, and its rolling time read as the Metrics monitor's", () => {
    const line: string | undefined = SUB_DESCRIPTIONS.split("\n").find(
      (candidate: string): boolean => {
        return candidate.includes('"xcp_ng_monitor":');
      },
    );

    expect(line).toBeDefined();
    expect(line).toContain("XCP-ng monitor config");
    expect(line).toContain("poolIdentifier");
    expect(line).toContain("the pool's UUID");
    expect(line).toContain(
      "rollingTime takes the values listed for `metric_monitor`, read the same way.",
    );
  });

  test("keeps a rolling time, read for the XCP-ng monitor type", () => {
    expect(ROLLING_TIME_SETTINGS).toContainEqual([
      XCP_NG_KEY,
      MonitorType.XcpNg,
    ]);
    expect(MonitorStepRollingTime.getStepKey(MonitorType.XcpNg)).toBe(
      XCP_NG_KEY,
    );
  });
});

describe("the provider's resource index", () => {
  test("files XCP-ng's resources under Infrastructure, beside Proxmox's", () => {
    for (const name of [
      "xcp_ng_pool",
      "xcp_ng_pool_label_rule",
      "xcp_ng_pool_owner_rule",
      "xcp_ng_pool_owner_team",
      "xcp_ng_pool_owner_user",
    ]) {
      expect({
        name,
        subcategory: DocumentationGenerator.getSubcategory(name),
      }).toEqual({
        name,
        subcategory: "Infrastructure",
      });
    }

    expect(DocumentationGenerator.getSubcategory("proxmox_cluster")).toBe(
      "Infrastructure",
    );
  });
});
