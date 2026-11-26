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
  // "" for a platform that authenticates with an API token alone.
  userVariable: string;
  extraFiles: Array<string>;
  secret: string;
}

interface ComposeFile {
  services: Record<
    string,
    {
      profiles?: Array<string> | undefined;
      volumes?: Array<string> | undefined;
      environment?: Array<string> | undefined;
    }
  >;
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
      expect({ line, fields: fields.length }).toEqual({ line, fields: 12 });
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
        userVariable: fields[9] === "-" ? "" : fields[9]!,
        extraFiles: fields[10] === "-" ? [] : fields[10]!.split(","),
        secret: fields[11]!,
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
        /*
         * Only an agent that talks to the array itself asks about its TLS:
         * the collector, or an exporter that logs in to it (Harvest).
         */
        tlsToArray:
          entry.config.exporterService === null || entry.config.userVariable
            ? "yes"
            : "no",
        userVariable: entry.config.userVariable || "",
        extraFiles: [...(entry.config.extraFiles || [])],
        // A user's password is the exporter's alone; a token the collector's.
        secret: entry.config.userVariable ? "password" : "token",
      });
      expect(line!.menu).not.toBe("");
      expect(line!.readHow).not.toBe("");
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
      if (line.userVariable) {
        /*
         * ...and its exporter logs in with the user and password the line
         * names, from its own files: the collector never holds them.
         */
        const exporterFiles: string = line.extraFiles
          .map((file: string): string => {
            return readAgentFile(file);
          })
          .join("\n");
        for (const variable of [
          line.endpointVariable,
          line.userVariable,
          line.tokenVariable,
        ]) {
          expect(exporterFiles).toContain(`\${${variable}}`);
          expect(text).not.toContain(variable);
        }
      } else {
        // ...and reads the address and token the line names.
        expect(text).toContain(`\${env:${line.endpointVariable}}`);
        expect(text).toContain(`\${env:${line.tokenVariable}}`);
      }

      // Every OneUptime serves it at /install/storage-array-agent/<config>.
      const entry: InstallScriptEntry | null = getInstallScriptEntry(
        InstallScriptName.StorageArrayAgent,
      );
      expect(entry?.files).toContain(config);
      // And its exporter's own files, which ship beside it.
      for (const file of line.extraFiles) {
        expect(fs.existsSync(path.join(AGENT_DIRECTORY, file))).toBe(true);
        expect(entry?.files).toContain(file);
      }
    },
  );

  test("an exporter that logs in itself is given its files and its login, and nothing else of .env", () => {
    const compose: ComposeFile = yaml.load(
      readAgentFile("docker-compose.yml"),
    ) as ComposeFile;
    for (const entry of REGISTERED) {
      if (!entry.config.userVariable || !entry.config.exporterService) {
        continue;
      }
      const service: ComposeFile["services"][string] =
        compose.services[entry.config.exporterService]!;
      const mounted: Array<string> = (service.volumes || []).map(
        (volume: string): string => {
          return volume.split(":")[0]!.replace(/^\.\//, "");
        },
      );
      expect(mounted.sort()).toEqual(
        [...(entry.config.extraFiles || [])].sort(),
      );
      const given: Array<string> = (service.environment || []).map(
        (variable: string): string => {
          return variable.split("=")[0]!;
        },
      );
      expect(given).toEqual(
        expect.arrayContaining([
          entry.config.endpointVariable,
          entry.config.userVariable,
          entry.config.tokenVariable,
        ]),
      );
      // No env_file: the ingestion key and every other platform's token stay out.
      expect(Object.keys(service)).not.toContain("env_file");
      for (const variable of given) {
        expect([
          entry.config.endpointVariable,
          entry.config.userVariable,
          entry.config.tokenVariable,
          "STORAGE_ARRAY_NAME",
          "STORAGE_ARRAY_INSECURE_SKIP_VERIFY",
        ]).toContain(variable);
      }
    }
  });

  test("install.sh downloads every exporter's own files with the configs", () => {
    const script: string = readAgentFile("install.sh");
    expect(script).toContain(
      'AGENT_FILES="docker-compose.yml $PLATFORM_CONFIGS${PLATFORM_EXTRA_FILES:+ $PLATFORM_EXTRA_FILES}"',
    );
    expect(script).toMatch(
      /PLATFORM_EXTRA_FILES="\$\(platform_lines \| cut -d '\|' -f 11/,
    );
    // A user's name is asked for, and a password is never refused for a $.
    expect(script).toContain(
      'USER_VARIABLE="$(platform_field "$PLATFORM_LINE" 10)"',
    );
    expect(script).toContain(
      'SECRET_KIND="$(platform_field "$PLATFORM_LINE" 12)"',
    );
    expect(script).toContain(
      'read -rsp "Password of the $ARRAY_NOUN\'s read-only user: "',
    );
  });

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
