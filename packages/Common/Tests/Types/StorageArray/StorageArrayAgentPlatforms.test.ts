import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import yaml from "js-yaml";
import path from "path";
import {
  InstallScriptEntry,
  InstallScriptName,
  getInstallScriptEntry,
} from "../../../Types/InstallScripts/InstallScripts";
import {
  StorageArrayAgentConfig,
  StorageArrayPlatform,
} from "../../../Types/StorageArray/StorageArrayPlatform";
import StorageArrayPlatformRegistry from "../../../Types/StorageArray/StorageArrayPlatformRegistry";

/*
 * THE AGENT'S PLATFORMS AND THE REGISTRY'S ARE ONE LIST (#11000).
 *
 * install.sh chooses a collector config from its PLATFORMS table - one line
 * per config - and from that line writes the platform, the compose profile
 * and the address and token variables to .env. Each platform says the same
 * of the configs it is read through (StorageArrayPlatform.agentConfigs),
 * for the Dashboard's setup guide. A new platform is its config file, one
 * line in the table and its agentConfigs: this holds the three in step,
 * and each config to what the compose file runs and what every OneUptime
 * serves.
 */

const AGENT_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../../../agents/StorageArrayAgent",
);

// A collector config's file name, as the agent ships each.
const COLLECTOR_CONFIG: RegExp = /^otel-collector-config[a-z0-9.-]*\.yaml$/;

interface TableLine {
  config: string;
  system: string;
  profile: string;
  endpointVariable: string;
  tokenVariable: string;
  tlsToArray: string;
  noun: string;
  menu: string;
  readHow: string;
  // A setup step of the platform's own (a function of install.sh), or "".
  setup: string;
}

interface ComposeFile {
  services: Record<string, { profiles?: Array<string> | undefined }>;
}

function readAgentFile(name: string): string {
  return fs.readFileSync(path.join(AGENT_DIRECTORY, name), "utf8");
}

function installTable(): Array<TableLine> {
  const table: RegExpMatchArray | null = readAgentFile("install.sh").match(
    /^PLATFORMS="\n([\s\S]*?)\n"$/m,
  );
  expect(table).not.toBeNull();
  return (table as RegExpMatchArray)[1]!
    .split("\n")
    .filter((line: string): boolean => {
      return line.trim() !== "";
    })
    .map((line: string): TableLine => {
      const fields: Array<string> = line.split("|");
      // Nine fields, and a tenth for a platform with a setup step of its own.
      expect({
        line,
        fields: fields.length === 10 ? 9 : fields.length,
      }).toEqual({ line, fields: 9 });
      return {
        config: fields[0]!,
        system: fields[1]!,
        profile: fields[2] === "-" ? "" : fields[2]!,
        endpointVariable: fields[3]!,
        tokenVariable: fields[4]!,
        tlsToArray: fields[5]!,
        noun: fields[6]!,
        menu: fields[7]!,
        readHow: fields[8]!,
        setup: fields[9] && fields[9] !== "-" ? fields[9] : "",
      };
    });
}

interface RegisteredConfig {
  platform: StorageArrayPlatform;
  config: StorageArrayAgentConfig;
}

const REGISTERED: Array<RegisteredConfig> =
  StorageArrayPlatformRegistry.getPlatforms().flatMap(
    (platform: StorageArrayPlatform): Array<RegisteredConfig> => {
      return platform.agentConfigs.map(
        (config: StorageArrayAgentConfig): RegisteredConfig => {
          return { platform, config };
        },
      );
    },
  );

const TABLE: Array<TableLine> = installTable();

describe("install.sh's PLATFORMS table and the registry's agent configs", () => {
  test("list the same configs in the same order, the default platform's first", () => {
    expect(
      TABLE.map((line: TableLine): string => {
        return line.config;
      }),
    ).toEqual(
      REGISTERED.map((entry: RegisteredConfig): string => {
        return entry.config.collectorConfigFile;
      }),
    );
    // The menu's first choice, which an empty answer picks.
    expect(TABLE[0]!.system).toBe(
      StorageArrayPlatformRegistry.getDefaultPlatform().storageSystem,
    );
  });

  test.each(
    REGISTERED.map((entry: RegisteredConfig): [string, RegisteredConfig] => {
      return [entry.config.collectorConfigFile, entry];
    }),
  )(
    "%s: the same platform, profile, variables and TLS question",
    (collectorConfigFile: string, entry: RegisteredConfig) => {
      const line: TableLine | undefined = TABLE.find(
        (candidate: TableLine): boolean => {
          return candidate.config === collectorConfigFile;
        },
      );
      expect(line).toBeDefined();
      expect(line).toMatchObject({
        system: entry.platform.storageSystem,
        profile: entry.config.composeProfile,
        endpointVariable: entry.config.endpointVariable,
        tokenVariable: entry.config.tokenVariable,
        noun: entry.config.arrayNoun,
        // Only a collector that talks to the array itself asks about its TLS.
        tlsToArray:
          (entry.config.talksTlsToArray ?? entry.config.exporterService === null)
            ? "yes"
            : "no",
      });
      expect(line!.menu).not.toBe("");
      expect(line!.readHow).not.toBe("");
      // A setup step the line names is a function of the script.
      if (line!.setup) {
        expect(readAgentFile("install.sh")).toContain(`\n${line!.setup}() {\n`);
      }
    },
  );
});

describe("each config of the table", () => {
  test.each(
    TABLE.map((line: TableLine): [string, TableLine] => {
      return [line.config, line];
    }),
  )(
    "%s ships, stamps its platform and is served",
    (config: string, line: TableLine) => {
      // The file is next to install.sh...
      const text: string = readAgentFile(config);
      // ...stamps the platform .env names, so ingest reads it as that one...
      expect(text).toMatch(
        /key: storage\.system\s+value: "?\$\{env:STORAGE_SYSTEM\}"?/,
      );
      // ...and reads the address and token the line names.
      expect(text).toContain(`\${env:${line.endpointVariable}}`);
      expect(text).toContain(`\${env:${line.tokenVariable}}`);

      // Every OneUptime serves it at /install/storage-array-agent/<config>.
      const entry: InstallScriptEntry | null = getInstallScriptEntry(
        InstallScriptName.StorageArrayAgent,
      );
      expect(entry?.files).toContain(config);
    },
  );

  test("whose exporter the compose file runs under the line's profile", () => {
    const compose: ComposeFile = yaml.load(
      readAgentFile("docker-compose.yml"),
    ) as ComposeFile;
    for (const entry of REGISTERED) {
      if (entry.config.exporterService === null) {
        continue;
      }
      expect(compose.services[entry.config.exporterService]?.profiles).toEqual([
        entry.config.composeProfile,
      ]);
    }
    // And every profile the compose file has is one a line starts.
    const profiles: Set<string> = new Set(
      TABLE.map((line: TableLine): string => {
        return line.profile;
      }).filter((profile: string): boolean => {
        return profile !== "";
      }),
    );
    for (const service of Object.values(compose.services)) {
      for (const profile of service.profiles || []) {
        expect(profiles.has(profile)).toBe(true);
      }
    }
  });

  test("every collector config next to install.sh is in the table", () => {
    const shipped: Array<string> = fs
      .readdirSync(AGENT_DIRECTORY)
      .filter((name: string): boolean => {
        return COLLECTOR_CONFIG.test(name);
      })
      .sort();
    expect(shipped).toEqual(
      TABLE.map((line: TableLine): string => {
        return line.config;
      }).sort(),
    );
  });
});
