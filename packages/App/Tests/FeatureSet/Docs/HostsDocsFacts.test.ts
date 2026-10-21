import { readPage } from "./DocsContentSupport";
import {
  HOST_COLLECTOR_EXPORTER_ENDPOINT,
  HOST_COLLECTOR_INGESTION_KEY_REFERENCE,
  HOST_COLLECTOR_PINNED_VERSION,
  HOST_COLLECTOR_SERVICE_NAME,
  HostCollectorOsType,
} from "Common/Types/HostCollector/HostCollector";
import {
  HostCollectorServiceCommands,
  getHostCollectorInstallCommand,
  getHostCollectorLabelName,
  getHostCollectorServiceCommands,
  getHostCollectorUninstallCommand,
  parseHostCollectorLabel,
} from "Common/Utils/HostCollector/HostCollectorInstallCommand";
import {
  FORBIDDEN_COMPONENT_SETTINGS,
  HostCollectorComponentKind,
  getAllowedComponentType,
} from "Common/Server/Utils/HostCollector/HostCollectorComponentCatalog";
import { HOST_COLLECTOR_SILENT_AFTER_MS } from "../../../FeatureSet/Dashboard/src/Components/HostCollector/HostCollectorStatus";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the English Hosts page (telemetry/hosts) says, held to what ships:
 * the commands are the ones the Dashboard builds (Add Host, a host's
 * Collector page), the options are the installers', the release is the one
 * OneUptime pins, the rules are the ones every config is checked against,
 * and the names on the page are the Dashboard's. Changing any of those
 * fails this until the page follows; InfrastructureAgentDocsTranslations
 * holds the 16 translations to the English page.
 */

const PAGE: string = readPage("en", "telemetry/hosts");

const SCRIPTS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Docs/Static/scripts/host-collector",
);
const INSTALL_SH: string = fs.readFileSync(
  path.join(SCRIPTS_DIR, "install.sh"),
  "utf8",
);
const INSTALL_PS1: string = fs.readFileSync(
  path.join(SCRIPTS_DIR, "install.ps1"),
  "utf8",
);

const DASHBOARD_EN: Record<string, string> = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../../../FeatureSet/Dashboard/src/Locales/en.json"),
    "utf8",
  ),
) as Record<string, string>;

const EXAMPLE_URL: string = "https://oneuptime.com";
const EXAMPLE_KEY: string = "YOUR_INGESTION_KEY";

// The text of one "## " section, up to the next.
function section(heading: string): string {
  const start: number = PAGE.indexOf(`\n## ${heading}\n`);
  if (start === -1) {
    throw new Error(`No section "${heading}"`);
  }
  const end: number = PAGE.indexOf("\n## ", start + 1);
  return PAGE.substring(start, end === -1 ? PAGE.length : end);
}

// The code of each tab of the first tab set in some text, by tab label.
function tabCode(text: string): Record<string, string> {
  const code: Record<string, string> = {};
  let tab: string | null = null;
  let inFence: boolean = false;
  let lines: Array<string> = [];

  for (const line of text.split("\n")) {
    if (line.startsWith("@tab ")) {
      tab = line.substring("@tab ".length).trim();
      continue;
    }

    if (line.startsWith("```")) {
      if (inFence) {
        if (tab) {
          code[tab] = lines.join("\n");
        }
        inFence = false;
        lines = [];
      } else {
        inFence = true;
      }
      continue;
    }

    if (inFence) {
      lines.push(line);
    }
  }

  return code;
}

// The rows of the first table in some text, cells trimmed.
function tableRows(text: string): Array<Array<string>> {
  return text
    .split("\n")
    .filter((line: string): boolean => {
      return line.startsWith("|") && !line.startsWith("| ---");
    })
    .slice(1)
    .map((line: string): Array<string> => {
      return line
        .split("|")
        .slice(1, -1)
        .map((cell: string): string => {
          return cell.trim();
        });
    });
}

function inlineCode(cell: string): Array<string> {
  const codes: Array<string> = [];
  let at: number = cell.indexOf("`");
  while (at !== -1) {
    const end: number = cell.indexOf("`", at + 1);
    if (end === -1) {
      break;
    }
    codes.push(cell.substring(at + 1, end));
    at = cell.indexOf("`", end + 1);
  }
  return codes;
}

const SYSTEMS: Array<[string, HostCollectorOsType]> = [
  ["Linux", HostCollectorOsType.Linux],
  ["macOS", HostCollectorOsType.MacOS],
  ["Windows", HostCollectorOsType.Windows],
];

describe("the commands on the page are the ones the Dashboard gives", () => {
  test("Add a host: one command per system", () => {
    const code: Record<string, string> = tabCode(section("Add a host"));

    for (const [tab, osType] of SYSTEMS) {
      expect(code[tab]).toBe(
        getHostCollectorInstallCommand({
          osType,
          oneuptimeUrl: EXAMPLE_URL,
          ingestionKey: EXAMPLE_KEY,
        }),
      );
    }
  });

  test("Label hosts: the same commands with two labels", () => {
    const code: Record<string, string> = tabCode(section("Label hosts"));

    for (const [tab, osType] of SYSTEMS) {
      expect(code[tab]).toBe(
        getHostCollectorInstallCommand({
          osType,
          oneuptimeUrl: EXAMPLE_URL,
          ingestionKey: EXAMPLE_KEY,
          labels: [
            { key: "env", value: "production" },
            { key: "team", value: "payments" },
          ],
        }),
      );
    }
  });

  test("a label typed as env=production is env:production in OneUptime", () => {
    const text: string = section("Label hosts");

    expect(text).toContain(
      "`env=production` becomes the label `env:production`",
    );
    expect(
      getHostCollectorLabelName(parseHostCollectorLabel("env=production")!),
    ).toBe("env:production");
  });

  test("Uninstall: the installer told to remove", () => {
    const code: Record<string, string> = tabCode(section("Uninstall"));

    for (const [tab, osType] of SYSTEMS) {
      expect(code[tab]).toBe(
        getHostCollectorUninstallCommand({
          osType,
          oneuptimeUrl: EXAMPLE_URL,
        }),
      );
    }
  });

  test("Check on a host's collector: the commands a host's Collector page shows", () => {
    const code: Record<string, string> = tabCode(
      section("Check on a host's collector"),
    );

    for (const [tab, osType] of SYSTEMS) {
      const commands: HostCollectorServiceCommands =
        getHostCollectorServiceCommands(osType);
      expect(code[tab]).toBe(
        [commands.status, commands.logs, commands.restart].join("\n"),
      );
    }
  });
});

describe("the installers' options", () => {
  const rows: Array<Array<string>> = tableRows(section("Install options"));

  test("every option the table lists is one the installers take", () => {
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const shellOption: string = (inlineCode(row[0]!)[0] || "").split(" ")[0]!;
      const windowsParameter: string = (inlineCode(row[1]!)[0] || "").split(
        " ",
      )[0]!;

      expect(INSTALL_SH).toMatch(new RegExp(`^\\s+${shellOption}\\)$`, "m"));
      expect(INSTALL_PS1).toMatch(
        new RegExp(
          `\\[(?:string|string\\[\\]|switch)\\]\\$${windowsParameter.substring(1)}\\b`,
        ),
      );
    }
  });

  test("every option the installers take is in the table", () => {
    const listed: Array<string> = rows.map((row: Array<string>): string => {
      return (inlineCode(row[0]!)[0] || "").split(" ")[0]!;
    });

    const options: Array<string> = [];
    for (const line of INSTALL_SH.split("\n")) {
      const match: RegExpMatchArray | null = line.match(/^\s+(--[a-z-]+)\)$/);
      if (match && match[1]) {
        options.push(match[1]);
      }
    }

    expect([...listed].sort()).toEqual([...options].sort());
  });

  test("the release installed by default is the one OneUptime pins", () => {
    const versionRow: Array<string> | undefined = rows.find(
      (row: Array<string>): boolean => {
        return row[0] === "`--version VERSION`";
      },
    );

    expect(versionRow?.[2]).toBe(
      `The collector release to install, ${HOST_COLLECTOR_PINNED_VERSION} by default.`,
    );
  });
});

describe("what a config may do", () => {
  const rules: string = section("What a config may do");

  test("data leaves the host only through otlphttp, to this OneUptime, with the host's key", () => {
    expect(rules).toContain(
      `Data leaves the host only through the \`otlp_http\` exporter, to \`${HOST_COLLECTOR_EXPORTER_ENDPOINT}\` with the header \`x-oneuptime-token: ${HOST_COLLECTOR_INGESTION_KEY_REFERENCE}\``,
    );
    expect(
      getAllowedComponentType(HostCollectorComponentKind.Exporter, "otlp_http"),
    ).toBe("otlp_http");
    expect(
      getAllowedComponentType(HostCollectorComponentKind.Exporter, "otlp"),
    ).toBeNull();
  });

  test("the setting it names as running a program is one the policy refuses", () => {
    expect(rules).toContain("journald's `journalctl_path`");
    expect(FORBIDDEN_COMPONENT_SETTINGS["journald"]).toContain(
      "journalctl_path",
    );
  });
});

describe("what the page says about the service", () => {
  test("its name, and the user and groups it runs as on Linux", () => {
    expect(PAGE).toContain(`the service \`${HOST_COLLECTOR_SERVICE_NAME}\``);
    expect(PAGE).toContain(
      `On Linux the collector runs as the unprivileged user \`${HOST_COLLECTOR_SERVICE_NAME}\`, in the \`systemd-journal\` and \`adm\` groups`,
    );
    expect(INSTALL_SH).toContain(
      `SERVICE_USER="${HOST_COLLECTOR_SERVICE_NAME}"`,
    );
    expect(INSTALL_SH).toContain("for group in systemd-journal adm; do");
  });

  test("a host is Not reporting after as long as the Dashboard waits", () => {
    expect(HOST_COLLECTOR_SILENT_AFTER_MS).toBe(15 * 60 * 1000);
    expect(section("Troubleshooting")).toContain(
      "OneUptime has not heard from the host's supervisor for more than 15 minutes.",
    );
  });

  test("a host set up by hand is handed over with --replace-existing, which stops otelcol-contrib", () => {
    expect(section("Hosts set up by hand")).toContain(
      "its command adds `--replace-existing`, which stops and disables the collector installed by hand (the `otelcol-contrib` service)",
    );
    expect(INSTALL_SH).toContain("systemctl disable --now otelcol-contrib");
  });

  test("the key refusals it explains are the statuses the installers report", () => {
    const text: string = section("Troubleshooting");

    expect(text).toContain("HTTP `401`");
    expect(text).toContain("HTTP `422`");
    expect(INSTALL_SH).toContain("for status in 401 403 422; do");
  });
});

describe("the names on the page are the Dashboard's", () => {
  test.each([
    ["Add Host"],
    ["Hosts"],
    ["Collector Configs"],
    ["Edit config"],
    ["Versions"],
    ["View"],
    ["Put back"],
    ["Change config"],
    ["Try again"],
    ["Config failed"],
    ["Collector"],
    ["Why this config"],
    ["Last report"],
    ["Collector release"],
    ["On the host"],
    ["OneUptime defaults"],
    ["Running"],
    ["Starting"],
    ["Label Rules"],
  ])("%s", (name: string) => {
    expect(PAGE).toContain(`**${name}**`);
    expect(DASHBOARD_EN[name]).toBeDefined();
  });

  test("Create Collector Config: the list's create button for a Collector Config", () => {
    expect(PAGE).toContain("**Create Collector Config**");
    expect(DASHBOARD_EN["Create {{itemName}}"]).toBeDefined();
    expect(DASHBOARD_EN["Collector Config"]).toBeDefined();
  });

  test.each([
    ["Products → Infrastructure → Hosts"],
    ["Products → Infrastructure → Hosts → Collector Configs"],
    ["Project Settings → Telemetry & APM → Ingestion Keys"],
  ])("the menu path %s", (menuPath: string) => {
    expect(PAGE).toContain(`**${menuPath}**`);
    for (const part of menuPath.split(" → ")) {
      expect(DASHBOARD_EN[part]).toBeDefined();
    }
  });
});
