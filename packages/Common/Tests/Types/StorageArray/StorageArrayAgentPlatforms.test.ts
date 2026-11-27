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
  userVariable: string;
  otherFiles: Array<string>;
  optionalVariables: Array<string>;
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
      const list: (field: string) => Array<string> = (
        field: string,
      ): Array<string> => {
        return field === "-" ? [] : field.split(" ");
      };
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
        otherFiles: list(fields[10]!),
        optionalVariables: list(fields[11]!),
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
         * the collector, or an exporter that checks the array's certificate
         * (NetApp Harvest).
         */
        tlsToArray:
          entry.config.exporterService === null ||
          entry.config.exporterChecksCertificate
            ? "yes"
            : "no",
        // An exporter that logs in itself: its user, and the files it runs with.
        userVariable: entry.config.userVariable || "",
        otherFiles: [...(entry.config.otherFiles || [])],
      });
      expect(line!.menu).not.toBe("");
      expect(line!.readHow).not.toBe("");
    },
  );

  test("only an exporter logs in with a user, and the collector never reads its password", () => {
    for (const entry of REGISTERED) {
      if (!entry.config.userVariable) {
        continue;
      }
      expect(entry.config.exporterService).not.toBeNull();
      const config: string = readAgentFile(entry.config.collectorConfigFile);
      expect(config).not.toContain(`\${env:${entry.config.tokenVariable}}`);
      expect(config).not.toContain(`\${env:${entry.config.userVariable}}`);
    }
  });
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
      if (!line.userVariable) {
        // ...and reads the address and token the line names.
        expect(text).toContain(`\${env:${line.endpointVariable}}`);
        expect(text).toContain(`\${env:${line.tokenVariable}}`);
      } else {
        // ...the exporter logs in with the line's user and password itself.
        expect(text).not.toContain(`\${env:${line.tokenVariable}}`);
        const exporterFiles: string = line.otherFiles
          .filter((file: string): boolean => {
            return /\.ya?ml$/.test(file);
          })
          .map((file: string): string => {
            return readAgentFile(file);
          })
          .join("\n");
        if (exporterFiles.includes(`\${${line.userVariable}}`)) {
          // NetApp Harvest reads the address, user and password from its own files.
          for (const variable of [
            line.endpointVariable,
            line.userVariable,
            line.tokenVariable,
          ]) {
            expect(exporterFiles).toContain(`\${${variable}}`);
            expect(text).not.toContain(variable);
          }
        } else {
          // Dell's exporter is asked for the array by its address.
          expect(text).toContain(`\${env:${line.endpointVariable}}`);
        }
      }

      /*
       * Every OneUptime serves it, and every other file it runs with, at
       * /install/storage-array-agent/<file>, and each ships next to it.
       */
      const entry: InstallScriptEntry | null = getInstallScriptEntry(
        InstallScriptName.StorageArrayAgent,
      );
      expect(entry?.files).toContain(config);
      for (const file of line.otherFiles) {
        expect(entry?.files).toContain(file);
        expect(fs.existsSync(path.join(AGENT_DIRECTORY, file))).toBe(true);
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
      // What it mounts is among the files it runs with (Harvest's, all four).
      for (const file of mounted) {
        expect(entry.config.otherFiles || []).toContain(file);
      }
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
