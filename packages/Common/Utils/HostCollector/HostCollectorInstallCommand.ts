import {
  HOST_COLLECTOR_INSTALL_SCRIPT_PATH,
  HOST_COLLECTOR_WINDOWS_INSTALL_SCRIPT_PATH,
  HostCollectorOsType,
} from "../../Types/HostCollector/HostCollector";

/*
 * The one command that adds a host: run on the host, it installs the
 * OpenTelemetry Collector and the OpAMP supervisor that keeps it on the
 * config OneUptime sends, and the host shows up under Hosts. The Dashboard
 * fills it in with the reader's OneUptime URL and ingestion key, and the
 * docs show the same command with placeholders.
 *
 * Linux and macOS pipe install.sh into a root shell; Windows runs
 * install.ps1 from an elevated PowerShell. Both take the same three things:
 * where OneUptime is, the key, and any labels for the host.
 */

export interface HostCollectorInstallCommandOptions {
  osType: HostCollectorOsType;
  oneuptimeUrl: string;
  ingestionKey: string;
  // key=value pairs the host is labelled with (env=production).
  labels?: Array<HostCollectorLabel> | undefined;
}

export interface HostCollectorLabel {
  key: string;
  value: string;
}

/*
 * What a label may be on the command line: the installer writes it into the
 * supervisor's YAML, so both sides keep to characters no shell, PowerShell
 * or YAML reads specially. A key names a dimension (env, team); a value may
 * also hold : / @ and spaces between words.
 */
const LABEL_KEY_MAX_LENGTH: number = 64;
const LABEL_VALUE_MAX_LENGTH: number = 128;

function isLabelKeyCharacter(char: string, index: number): boolean {
  const isAlphanumeric: boolean =
    (char >= "a" && char <= "z") ||
    (char >= "A" && char <= "Z") ||
    (char >= "0" && char <= "9");

  if (index === 0) {
    return isAlphanumeric;
  }

  return isAlphanumeric || char === "_" || char === "-" || char === ".";
}

function isLabelValueCharacter(char: string, index: number): boolean {
  if (isLabelKeyCharacter(char, 0)) {
    return true;
  }

  if (index === 0) {
    return false;
  }

  return (
    char === "_" ||
    char === "-" ||
    char === "." ||
    char === ":" ||
    char === "/" ||
    char === "@" ||
    char === " "
  );
}

export function isHostCollectorLabelKey(key: string): boolean {
  if (key.length === 0 || key.length > LABEL_KEY_MAX_LENGTH) {
    return false;
  }

  for (let index: number = 0; index < key.length; index++) {
    if (!isLabelKeyCharacter(key.charAt(index), index)) {
      return false;
    }
  }

  return true;
}

export function isHostCollectorLabelValue(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > LABEL_VALUE_MAX_LENGTH ||
    value.endsWith(" ")
  ) {
    return false;
  }

  for (let index: number = 0; index < value.length; index++) {
    if (!isLabelValueCharacter(value.charAt(index), index)) {
      return false;
    }
  }

  return true;
}

/*
 * A label as people type it ("env=production" or "env:production"), or
 * null when it is not one the installer takes.
 */
export function parseHostCollectorLabel(
  text: string,
): HostCollectorLabel | null {
  const trimmed: string = text.trim();
  const equals: number = trimmed.indexOf("=");
  const colon: number = trimmed.indexOf(":");
  const separator: number =
    equals === -1 ? colon : colon === -1 ? equals : Math.min(equals, colon);

  if (separator <= 0) {
    return null;
  }

  const key: string = trimmed.substring(0, separator).trim();
  const value: string = trimmed.substring(separator + 1).trim();

  if (!isHostCollectorLabelKey(key) || !isHostCollectorLabelValue(value)) {
    return null;
  }

  return { key, value };
}

// The label OneUptime gives a host for it: env:production.
export function getHostCollectorLabelName(label: HostCollectorLabel): string {
  return `${label.key}:${label.value}`;
}

/*
 * A value in single quotes for sh: a ' inside closes the quote, escapes
 * itself and reopens. A value made only of characters sh leaves alone stays
 * bare, so the usual command has no quotes in it.
 */
function quoteForShell(value: string): string {
  const isPlain: boolean =
    value.length > 0 &&
    value.split("").every((char: string): boolean => {
      return (
        isLabelKeyCharacter(char, 0) ||
        "._:/@%+,=-".indexOf(char) !== -1
      );
    });

  return isPlain ? value : `'${value.split("'").join("'\\''")}'`;
}

// A PowerShell string literal: single quotes, a ' inside doubled.
function quoteForPowerShell(value: string): string {
  return `'${value.split("'").join("''")}'`;
}

// The URL without the slashes it may end with: https://oneuptime.com.
export function trimHostCollectorUrl(url: string): string {
  let end: number = url.length;
  while (end > 0 && url.charAt(end - 1) === "/") {
    end--;
  }
  return url.substring(0, end).trim();
}

function getScriptUrl(oneuptimeUrl: string, path: string): string {
  return `${trimHostCollectorUrl(oneuptimeUrl)}${path}`;
}

function getValidLabels(
  labels: Array<HostCollectorLabel> | undefined,
): Array<HostCollectorLabel> {
  return (labels || []).filter((label: HostCollectorLabel): boolean => {
    return (
      isHostCollectorLabelKey(label.key) &&
      isHostCollectorLabelValue(label.value)
    );
  });
}

// The command for Linux and macOS: one line, run as any user with sudo.
export function getHostCollectorShellInstallCommand(
  options: Omit<HostCollectorInstallCommandOptions, "osType">,
): string {
  const words: Array<string> = [
    `curl -fsSL ${quoteForShell(
      getScriptUrl(options.oneuptimeUrl, HOST_COLLECTOR_INSTALL_SCRIPT_PATH),
    )}`,
    "|",
    "sudo sh -s --",
    `--url ${quoteForShell(trimHostCollectorUrl(options.oneuptimeUrl))}`,
    `--key ${quoteForShell(options.ingestionKey)}`,
  ];

  for (const label of getValidLabels(options.labels)) {
    words.push(`--label ${quoteForShell(`${label.key}=${label.value}`)}`);
  }

  return words.join(" ");
}

/*
 * The command for Windows, for an elevated PowerShell (Run as
 * administrator). It turns on TLS 1.2 first, which Windows PowerShell 5.1
 * on Windows Server 2016 does not use by default, then runs install.ps1
 * with its parameters.
 */
export function getHostCollectorPowerShellInstallCommand(
  options: Omit<HostCollectorInstallCommandOptions, "osType">,
): string {
  const scriptUrl: string = getScriptUrl(
    options.oneuptimeUrl,
    HOST_COLLECTOR_WINDOWS_INSTALL_SCRIPT_PATH,
  );

  const parameters: Array<string> = [
    `-Url ${quoteForPowerShell(trimHostCollectorUrl(options.oneuptimeUrl))}`,
    `-Key ${quoteForPowerShell(options.ingestionKey)}`,
  ];

  const labels: Array<HostCollectorLabel> = getValidLabels(options.labels);
  if (labels.length > 0) {
    parameters.push(
      `-Label ${labels
        .map((label: HostCollectorLabel): string => {
          return quoteForPowerShell(`${label.key}=${label.value}`);
        })
        .join(",")}`,
    );
  }

  return `[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; & ([scriptblock]::Create((Invoke-RestMethod -Uri ${quoteForPowerShell(
    scriptUrl,
  )}))) ${parameters.join(" ")}`;
}

export function getHostCollectorInstallCommand(
  options: HostCollectorInstallCommandOptions,
): string {
  if (options.osType === HostCollectorOsType.Windows) {
    return getHostCollectorPowerShellInstallCommand(options);
  }

  return getHostCollectorShellInstallCommand(options);
}

// The language a command is written in, for its code block.
export function getHostCollectorInstallCommandLanguage(
  osType: HostCollectorOsType,
): "bash" | "powershell" {
  return osType === HostCollectorOsType.Windows ? "powershell" : "bash";
}

// Taking the collector off a host again: the same installer, told to remove.
export function getHostCollectorUninstallCommand(data: {
  osType: HostCollectorOsType;
  oneuptimeUrl: string;
}): string {
  if (data.osType === HostCollectorOsType.Windows) {
    return `& ([scriptblock]::Create((Invoke-RestMethod -Uri ${quoteForPowerShell(
      getScriptUrl(data.oneuptimeUrl, HOST_COLLECTOR_WINDOWS_INSTALL_SCRIPT_PATH),
    )}))) -Uninstall`;
  }

  return `curl -fsSL ${quoteForShell(
    getScriptUrl(data.oneuptimeUrl, HOST_COLLECTOR_INSTALL_SCRIPT_PATH),
  )} | sudo sh -s -- --uninstall`;
}
