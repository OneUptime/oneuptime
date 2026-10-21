import {
  HostCollectorLabel,
  getHostCollectorInstallCommand,
  getHostCollectorInstallCommandLanguage,
  getHostCollectorLabelName,
  getHostCollectorPowerShellInstallCommand,
  getHostCollectorServiceCommands,
  getHostCollectorShellInstallCommand,
  getHostCollectorUninstallCommand,
  isHostCollectorLabelKey,
  isHostCollectorLabelValue,
  parseHostCollectorLabel,
  trimHostCollectorUrl,
} from "../../../Utils/HostCollector/HostCollectorInstallCommand";
import {
  HOST_COLLECTOR_MACOS_LOG_FILE,
  HOST_COLLECTOR_MACOS_SERVICE_LABEL,
  HOST_COLLECTOR_SERVICE_NAME,
  HostCollectorOsType,
} from "../../../Types/HostCollector/HostCollector";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";
import { SpawnSyncReturns, spawnSync } from "child_process";

/*
 * The one command that adds a host. People paste it into a root shell (or
 * an elevated PowerShell) on every machine they add, so it must say exactly
 * what the Dashboard means: the URL, the key and the labels arrive at the
 * installer as the very values typed, whatever they hold, and a label the
 * installer would refuse is never put in the command.
 */

const URL: string = "https://oneuptime.example.com";
const KEY: string = "a1b2c3d4-0000-4000-8000-00000000f00d";

/*
 * What sh hands the installer for a command: curl and sudo are replaced by
 * functions, so the pipeline runs nowhere, and sudo prints each argument it
 * is given on a line of its own (what install.sh would read as "$@").
 */
function shellArguments(command: string): Array<string> {
  const script: string = [
    "curl() { :; }",
    'sudo() { for argument in "$@"; do printf \'%s\\n\' "$argument"; done; }',
    command,
  ].join("\n");

  const result: SpawnSyncReturns<string> = spawnSync("sh", ["-c", script], {
    encoding: "utf8",
  });

  expect(result.status).toBe(0);

  return result.stdout.split("\n").slice(0, -1);
}

/*
 * The URL curl is asked for, by the same trick: curl writes its arguments
 * to stderr, past the pipe into sudo.
 */
function shellScriptUrl(command: string): string {
  const script: string = [
    'curl() { for argument in "$@"; do printf \'%s\\n\' "$argument" >&2; done; }',
    "sudo() { cat >/dev/null; }",
    command,
  ].join("\n");

  const result: SpawnSyncReturns<string> = spawnSync("sh", ["-c", script], {
    encoding: "utf8",
  });

  expect(result.status).toBe(0);

  const words: Array<string> = result.stderr.split("\n").slice(0, -1);
  expect(words.slice(0, -1)).toEqual(["-fsSL"]);
  return words[words.length - 1] as string;
}

describe("the command for Linux and macOS", () => {
  test("pipes the installer of this OneUptime into a root shell with the URL and key", () => {
    expect(
      getHostCollectorShellInstallCommand({
        oneuptimeUrl: URL,
        ingestionKey: KEY,
      }),
    ).toBe(
      `curl -fsSL ${URL}/docs/static/scripts/host-collector/install.sh | sudo sh -s -- --url ${URL} --key ${KEY}`,
    );
  });

  test("is the same on macOS as on Linux", () => {
    for (const osType of [
      HostCollectorOsType.Linux,
      HostCollectorOsType.MacOS,
    ]) {
      expect(
        getHostCollectorInstallCommand({
          osType: osType,
          oneuptimeUrl: URL,
          ingestionKey: KEY,
        }),
      ).toBe(
        getHostCollectorShellInstallCommand({
          oneuptimeUrl: URL,
          ingestionKey: KEY,
        }),
      );
    }
  });

  test("a URL that ends in slashes is used without them", () => {
    const command: string = getHostCollectorShellInstallCommand({
      oneuptimeUrl: `${URL}///`,
      ingestionKey: KEY,
    });

    expect(command).toContain(
      `${URL}/docs/static/scripts/host-collector/install.sh |`,
    );
    expect(shellArguments(command)).toEqual([
      "sh",
      "-s",
      "--",
      "--url",
      URL,
      "--key",
      KEY,
    ]);
  });

  test("labels and --replace-existing follow the key, in the order given", () => {
    const command: string = getHostCollectorShellInstallCommand({
      oneuptimeUrl: URL,
      ingestionKey: KEY,
      labels: [
        { key: "env", value: "production" },
        { key: "team", value: "web platform" },
      ],
      replaceExisting: true,
    });

    expect(shellArguments(command)).toEqual([
      "sh",
      "-s",
      "--",
      "--url",
      URL,
      "--key",
      KEY,
      "--label",
      "env=production",
      "--label",
      "team=web platform",
      "--replace-existing",
    ]);
  });

  test("a label the installer would refuse is left out of the command", () => {
    const command: string = getHostCollectorShellInstallCommand({
      oneuptimeUrl: URL,
      ingestionKey: KEY,
      labels: [
        { key: "env", value: "production" },
        { key: "bad key", value: "x" },
        { key: "team", value: "$(reboot)" },
        { key: "", value: "x" },
        { key: "site", value: "" },
      ],
    });

    expect(command).not.toContain("reboot");
    expect(shellArguments(command)).toEqual([
      "sh",
      "-s",
      "--",
      "--url",
      URL,
      "--key",
      KEY,
      "--label",
      "env=production",
    ]);
  });

  test("a value sh would read specially reaches the installer as typed", () => {
    const awkward: Array<string> = [
      "it's",
      "a b",
      "$(id)",
      "`id`",
      "a;b",
      "a|b",
      "a&b",
      '"quoted"',
      "back\\slash",
      "*",
      "~",
      "a'b'c",
      "''",
    ];

    for (const value of awkward) {
      const command: string = getHostCollectorShellInstallCommand({
        oneuptimeUrl: URL,
        ingestionKey: value,
      });

      expect(shellArguments(command)).toEqual([
        "sh",
        "-s",
        "--",
        "--url",
        URL,
        "--key",
        value,
      ]);
    }
  });

  test("any URL and key, drawn at random, reach the installer as typed", () => {
    const random: SeededRandom = seededRandom(20261021);
    const alphabet: string = "abcXYZ019 '\"$`\\;|&<>()[]{}*?~#!%^=+,.:/@-_\t";

    const draw: (length: number) => string = (length: number): string => {
      let text: string = "";
      for (let index: number = 0; index < length; index++) {
        text += alphabet.charAt(random(alphabet.length));
      }
      return text;
    };

    for (let attempt: number = 0; attempt < 60; attempt++) {
      const key: string = `k${draw(1 + random(24))}`;
      const url: string = `https://h${draw(random(12)).split("/").join("")}x`;
      const command: string = getHostCollectorShellInstallCommand({
        oneuptimeUrl: url,
        ingestionKey: key,
      });

      expect(shellArguments(command)).toEqual([
        "sh",
        "-s",
        "--",
        "--url",
        trimHostCollectorUrl(url),
        "--key",
        key,
      ]);
      expect(shellScriptUrl(command)).toBe(
        `${trimHostCollectorUrl(url)}/docs/static/scripts/host-collector/install.sh`,
      );
    }
  });

  test("the usual command needs no quotes", () => {
    const command: string = getHostCollectorShellInstallCommand({
      oneuptimeUrl: URL,
      ingestionKey: KEY,
      labels: [{ key: "env", value: "production" }],
    });

    expect(command).not.toContain("'");
    expect(command).not.toContain('"');
  });
});

describe("the command for Windows", () => {
  test("turns on TLS 1.2, then runs install.ps1 of this OneUptime with the URL and key", () => {
    expect(
      getHostCollectorInstallCommand({
        osType: HostCollectorOsType.Windows,
        oneuptimeUrl: `${URL}/`,
        ingestionKey: KEY,
      }),
    ).toBe(
      `[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; & ([scriptblock]::Create((Invoke-RestMethod -Uri '${URL}/docs/static/scripts/host-collector/install.ps1'))) -Url '${URL}' -Key '${KEY}'`,
    );
  });

  test("labels go in one -Label list, then -ReplaceExisting", () => {
    expect(
      getHostCollectorPowerShellInstallCommand({
        oneuptimeUrl: URL,
        ingestionKey: KEY,
        labels: [
          { key: "env", value: "production" },
          { key: "team", value: "payments" },
          { key: "no good", value: "x" },
        ],
        replaceExisting: true,
      }),
    ).toMatch(
      / -Url '[^']+' -Key '[^']+' -Label 'env=production','team=payments' -ReplaceExisting$/,
    );
  });

  test("a single quote in a value is doubled, as PowerShell reads it", () => {
    const command: string = getHostCollectorPowerShellInstallCommand({
      oneuptimeUrl: URL,
      ingestionKey: "it's",
    });

    expect(command.endsWith(`-Key 'it''s'`)).toBe(true);
  });
});

describe("the language each command is shown in", () => {
  test("bash for Linux and macOS, PowerShell for Windows", () => {
    expect(
      getHostCollectorInstallCommandLanguage(HostCollectorOsType.Linux),
    ).toBe("bash");
    expect(
      getHostCollectorInstallCommandLanguage(HostCollectorOsType.MacOS),
    ).toBe("bash");
    expect(
      getHostCollectorInstallCommandLanguage(HostCollectorOsType.Windows),
    ).toBe("powershell");
  });
});

describe("taking the collector off a host", () => {
  test("is the same installer, told to remove", () => {
    expect(
      getHostCollectorUninstallCommand({
        osType: HostCollectorOsType.Linux,
        oneuptimeUrl: `${URL}/`,
      }),
    ).toBe(
      `curl -fsSL ${URL}/docs/static/scripts/host-collector/install.sh | sudo sh -s -- --uninstall`,
    );
    expect(
      getHostCollectorUninstallCommand({
        osType: HostCollectorOsType.MacOS,
        oneuptimeUrl: URL,
      }),
    ).toBe(
      getHostCollectorUninstallCommand({
        osType: HostCollectorOsType.Linux,
        oneuptimeUrl: URL,
      }),
    );
    expect(
      getHostCollectorUninstallCommand({
        osType: HostCollectorOsType.Windows,
        oneuptimeUrl: URL,
      }),
    ).toBe(
      `& ([scriptblock]::Create((Invoke-RestMethod -Uri '${URL}/docs/static/scripts/host-collector/install.ps1'))) -Uninstall`,
    );
  });

  test("sh hands the installer only --uninstall", () => {
    expect(
      shellArguments(
        getHostCollectorUninstallCommand({
          osType: HostCollectorOsType.Linux,
          oneuptimeUrl: URL,
        }),
      ),
    ).toEqual(["sh", "-s", "--", "--uninstall"]);
  });
});

describe("checking on the service the installer set up", () => {
  test("Linux: systemd and the journal, by the service's name", () => {
    expect(getHostCollectorServiceCommands(HostCollectorOsType.Linux)).toEqual({
      status: `sudo systemctl status ${HOST_COLLECTOR_SERVICE_NAME}`,
      logs: `sudo journalctl -u ${HOST_COLLECTOR_SERVICE_NAME} -n 50`,
      restart: `sudo systemctl restart ${HOST_COLLECTOR_SERVICE_NAME}`,
    });
  });

  test("macOS: launchd by the daemon's label, and the log file it writes", () => {
    expect(getHostCollectorServiceCommands(HostCollectorOsType.MacOS)).toEqual({
      status: `sudo launchctl print system/${HOST_COLLECTOR_MACOS_SERVICE_LABEL}`,
      logs: `sudo tail -n 50 ${HOST_COLLECTOR_MACOS_LOG_FILE}`,
      restart: `sudo launchctl kickstart -k system/${HOST_COLLECTOR_MACOS_SERVICE_LABEL}`,
    });
  });

  test("Windows: the service, and its events in the Application log", () => {
    expect(
      getHostCollectorServiceCommands(HostCollectorOsType.Windows),
    ).toEqual({
      status: `Get-Service ${HOST_COLLECTOR_SERVICE_NAME}`,
      logs: `Get-WinEvent -FilterHashtable @{ LogName = 'Application'; ProviderName = '${HOST_COLLECTOR_SERVICE_NAME}' } -MaxEvents 50 | Format-List TimeCreated, Message`,
      restart: `Restart-Service ${HOST_COLLECTOR_SERVICE_NAME}`,
    });
  });

  test("a host whose system is not known yet is shown the Linux commands", () => {
    expect(getHostCollectorServiceCommands(null)).toEqual(
      getHostCollectorServiceCommands(HostCollectorOsType.Linux),
    );
    expect(getHostCollectorServiceCommands(undefined)).toEqual(
      getHostCollectorServiceCommands(HostCollectorOsType.Linux),
    );
  });
});

describe("labels on the command line", () => {
  test.each([
    ["env=production", { key: "env", value: "production" }],
    ["env:production", { key: "env", value: "production" }],
    ["  env = production  ", { key: "env", value: "production" }],
    ["team=web platform", { key: "team", value: "web platform" }],
    ["owner=ops@example.com", { key: "owner", value: "ops@example.com" }],
    ["path=a/b:c", { key: "path", value: "a/b:c" }],
    ["k8s.cluster=prod-1", { key: "k8s.cluster", value: "prod-1" }],
    ["a=b:c", { key: "a", value: "b:c" }],
    ["a:b/c", { key: "a", value: "b/c" }],
  ])("%p is a label", (text: string, expected: HostCollectorLabel) => {
    expect(parseHostCollectorLabel(text)).toEqual(expected);
  });

  test.each([
    ["no separator", "production"],
    ["no key", "=production"],
    ["no value", "env="],
    ["a key with a space", "my env=production"],
    ["a key starting with a dash", "-env=production"],
    ["a value starting with a dash", "env=-production"],
    ["a value holding =", "a:b=c"],
    ["a quote", "env=it's"],
    ["a shell expansion", "env=$(id)"],
    ["a line break", "env=pro\nduction"],
    ["a key too long", `${"k".repeat(65)}=v`],
    ["a value too long", `k=${"v".repeat(129)}`],
  ])("%s is not a label", (_label: string, text: string) => {
    expect(parseHostCollectorLabel(text)).toBeNull();
  });

  test("keys of 64 and values of 128 characters are the longest", () => {
    expect(isHostCollectorLabelKey("k".repeat(64))).toBe(true);
    expect(isHostCollectorLabelKey("k".repeat(65))).toBe(false);
    expect(isHostCollectorLabelValue("v".repeat(128))).toBe(true);
    expect(isHostCollectorLabelValue("v".repeat(129))).toBe(false);
  });

  test("a value may not end in a space, which the installer could not keep", () => {
    expect(isHostCollectorLabelValue("web ")).toBe(false);
    expect(isHostCollectorLabelValue("web platform")).toBe(true);
  });

  test("a host installed with env=production is labelled env:production", () => {
    expect(getHostCollectorLabelName({ key: "env", value: "production" })).toBe(
      "env:production",
    );
  });
});
