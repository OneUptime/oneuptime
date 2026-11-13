import {
  HOST_COLLECTOR_INGESTION_KEY_ENV,
  HOST_COLLECTOR_LABEL_ATTRIBUTE_PREFIX,
  HOST_COLLECTOR_MACOS_LOG_FILE,
  HOST_COLLECTOR_MACOS_SERVICE_LABEL,
  HOST_COLLECTOR_OPAMP_PATH,
  HOST_COLLECTOR_OPAMP_ROUTE,
  HOST_COLLECTOR_PINNED_VERSION,
  HOST_COLLECTOR_SERVICE_NAME,
  HOST_COLLECTOR_URL_ENV,
} from "Common/Types/HostCollector/HostCollector";
import {
  getHostCollectorShellInstallCommand,
  isHostCollectorLabelKey,
  isHostCollectorLabelValue,
} from "Common/Utils/HostCollector/HostCollectorInstallCommand";
import {
  HOST_FEATURE_JOURNALD_ATTRIBUTE,
  HOST_FEATURE_SYSTEMD_ATTRIBUTE,
} from "Common/Server/Utils/HostCollector/OpAmp/OpAmpExchange";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { SpawnSyncReturns, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * The two installers every OneUptime serves to add a host in one command:
 * install.sh (Linux and macOS) and install.ps1 (Windows). They are run as
 * root on customers' machines, so they are held here to what OneUptime and
 * the docs say about them: the release they pin, the names of what they
 * install, the supervisor config they write (the URL, the key, the labels,
 * what they found on the host, and a config that does not start rolled
 * back), the checks on everything they are given - before anything needs
 * root - and the downloads checked against their published SHA-256.
 *
 * install.sh is run for real, with `id` answering as an ordinary user, so a
 * run that passes every check stops at "Run this as root" and installs
 * nothing, whoever runs the suite.
 */

const SCRIPTS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Docs/Static/scripts/host-collector",
);
const INSTALL_SH: string = path.join(SCRIPTS_DIR, "install.sh");
const INSTALL_PS1: string = path.join(SCRIPTS_DIR, "install.ps1");

const SH: string = fs.readFileSync(INSTALL_SH, "utf8");
const PS1: string = fs.readFileSync(INSTALL_PS1, "utf8");

// A folder whose `id` says this is not root, put first on PATH.
let notRootBin: string;

beforeAll(() => {
  notRootBin = fs.mkdtempSync(path.join(os.tmpdir(), "host-collector-sh-"));
  fs.writeFileSync(
    path.join(notRootBin, "id"),
    '#!/bin/sh\nif [ "$1" = "-u" ]; then echo 1000; else echo oneuptime; fi\n',
    { mode: 0o755 },
  );
});

afterAll(() => {
  fs.rmSync(notRootBin, { recursive: true, force: true });
});

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runInstaller(args: Array<string>): Run {
  const result: SpawnSyncReturns<string> = spawnSync(
    "sh",
    [INSTALL_SH, ...args],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${notRootBin}${path.delimiter}${process.env["PATH"] || ""}`,
      },
      timeout: 20000,
    },
  );

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/*
 * install.sh's helpers, without running it: everything before main(), then
 * the commands given.
 */
function runHelpers(commands: string): string {
  const helpers: string = SH.substring(0, SH.indexOf("\nmain() {"));
  const result: SpawnSyncReturns<string> = spawnSync(
    "sh",
    ["-c", `${helpers}\n${commands}`],
    { encoding: "utf8", timeout: 20000 },
  );

  expect(result.stderr).toBe("");
  return result.stdout;
}

function shellQuote(value: string): string {
  return `'${value.split("'").join("'\\''")}'`;
}

describe("the release they install", () => {
  test("both pin the release OneUptime pins", () => {
    expect(SH).toContain(`PINNED_VERSION="${HOST_COLLECTOR_PINNED_VERSION}"`);
    expect(PS1).toContain(
      `[string]$Version = "${HOST_COLLECTOR_PINNED_VERSION}"`,
    );
    expect(PS1).toContain(
      `-Version must be a release number, such as ${HOST_COLLECTOR_PINNED_VERSION}.`,
    );
  });

  test("both download otelcol-contrib and opampsupervisor from the OpenTelemetry Collector releases", () => {
    const releases: string =
      "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download";

    expect(SH).toContain(`DEFAULT_DOWNLOAD_URL="${releases}"`);
    expect(PS1).toContain(`[string]$DownloadUrl = "${releases}"`);
    expect(SH).toContain(
      'COLLECTOR_ARCHIVE="otelcol-contrib_${VERSION}_${OS}_${ARCH}.tar.gz"',
    );
    expect(SH).toContain(
      'SUPERVISOR_BINARY="opampsupervisor_${VERSION}_${OS}_${ARCH}"',
    );
    expect(SH).toContain("cmd%2Fopampsupervisor%2Fv${VERSION}");
    expect(PS1).toContain(
      '"otelcol-contrib_${Version}_windows_${Arch}.tar.gz"',
    );
    expect(PS1).toContain('"opampsupervisor_${Version}_windows_${Arch}.exe"');
    expect(PS1).toContain("cmd%2Fopampsupervisor%2Fv$Version");
  });

  test("both check every download against the SHA-256 published beside it", () => {
    expect(SH).toContain('"$url.sha256"');
    expect(SH).toContain(
      "does not match its published SHA-256. Nothing was installed.",
    );
    expect((SH.match(/download_checked "/g) || []).length).toBe(2);

    expect(PS1).toContain('($FromUrl + ".sha256")');
    expect(PS1).toContain("Get-FileHash -Algorithm SHA256");
    expect((PS1.match(/Get-CheckedDownload "/g) || []).length).toBe(2);
  });
});

describe("what they set up", () => {
  test("the service has the name OneUptime tells people to check it by", () => {
    expect(SH).toContain(`SERVICE_NAME="${HOST_COLLECTOR_SERVICE_NAME}"`);
    expect(SH).toContain(`SERVICE_USER="${HOST_COLLECTOR_SERVICE_NAME}"`);
    expect(SH).toContain(`MACOS_LABEL="${HOST_COLLECTOR_MACOS_SERVICE_LABEL}"`);
    expect(PS1).toContain(`$ServiceName = "${HOST_COLLECTOR_SERVICE_NAME}"`);
  });

  test("macOS writes the log where OneUptime tells people to read it", () => {
    const logDir: string = path.posix.dirname(HOST_COLLECTOR_MACOS_LOG_FILE);

    expect(SH).toContain(`LOG_DIR="${logDir}"`);
    expect(SH).toContain(
      "<key>StandardOutPath</key><string>$LOG_DIR/collector.log</string>",
    );
    expect(path.posix.basename(HOST_COLLECTOR_MACOS_LOG_FILE)).toBe(
      "collector.log",
    );
  });

  test("Linux runs it unprivileged, reading the journal and /var/log", () => {
    expect(SH).toContain("User=$SERVICE_USER");
    expect(SH).toContain("NoNewPrivileges=yes");
    expect(SH).toContain("for group in systemd-journal adm; do");
  });

  test("the supervisor asks this OneUptime for its config, with the key", () => {
    expect(SH).toContain(`OPAMP_PATH="${HOST_COLLECTOR_OPAMP_PATH}"`);
    expect(SH).toContain('endpoint: $(yaml_quote "$ONEUPTIME_URL$OPAMP_PATH")');
    expect(PS1).toContain(`$OpAmpPath = "${HOST_COLLECTOR_OPAMP_PATH}"`);
    expect(PS1).toContain('endpoint: $(ConvertTo-YamlString "$Url$OpAmpPath")');
    expect(SH).toContain('x-oneuptime-token: $(yaml_quote "$INGESTION_KEY")');
    expect(PS1).toContain("x-oneuptime-token: $(ConvertTo-YamlString $Key)");
  });

  test("they ask at the OpAMP route under /telemetry, which every OneUptime ingress sends to the App", () => {
    /*
     * The bare route (/opamp/v1) reached the marketing site on
     * oneuptime.com, so every host installed against it got a 404 and no
     * config. Nginx's TelemetryIngestRouting tests hold the ingress to both.
     */
    expect(HOST_COLLECTOR_OPAMP_PATH).toBe(
      `/telemetry${HOST_COLLECTOR_OPAMP_ROUTE}`,
    );

    for (const script of [SH, PS1]) {
      // One address, in one place: nothing else names the route.
      expect(script.split(HOST_COLLECTOR_OPAMP_ROUTE).length - 1).toBe(1);
    }
  });

  test("the config install.sh writes points the supervisor at the URL it was given, under /telemetry", () => {
    const written: string = runHelpers(
      [
        `ONEUPTIME_URL="$(trim_url 'https://oneuptime.example.com/')"`,
        `printf 'endpoint: %s\\n' "$(yaml_quote "$ONEUPTIME_URL$OPAMP_PATH")"`,
      ].join("\n"),
    );

    expect(written).toBe(
      `endpoint: "https://oneuptime.example.com${HOST_COLLECTOR_OPAMP_PATH}"\n`,
    );
  });

  test("the collector gets the URL and key every config refers to", () => {
    expect(SH).toContain(
      `${HOST_COLLECTOR_URL_ENV}: $(yaml_quote "$ONEUPTIME_URL")`,
    );
    expect(SH).toContain(
      `${HOST_COLLECTOR_INGESTION_KEY_ENV}: $(yaml_quote "$INGESTION_KEY")`,
    );
    expect(PS1).toContain(
      `${HOST_COLLECTOR_URL_ENV}: $(ConvertTo-YamlString $Url)`,
    );
    expect(PS1).toContain(
      `${HOST_COLLECTOR_INGESTION_KEY_ENV}: $(ConvertTo-YamlString $Key)`,
    );
  });

  test("labels and what the installer found reach OneUptime by the names it reads", () => {
    expect(SH).toContain(
      `${HOST_COLLECTOR_LABEL_ATTRIBUTE_PREFIX}\${label_key}`,
    );
    expect(PS1).toContain(
      `${HOST_COLLECTOR_LABEL_ATTRIBUTE_PREFIX}$($parsed.Key)`,
    );
    expect(SH).toContain(`${HOST_FEATURE_JOURNALD_ATTRIBUTE}: "$HAS_JOURNALD"`);
    expect(SH).toContain(
      `${HOST_FEATURE_SYSTEMD_ATTRIBUTE}: "$HAS_SYSTEMD_BUS"`,
    );
  });

  test("a config is checked before the collector switches to it, and one that does not start is rolled back", () => {
    for (const script of [SH, PS1]) {
      expect(script).toContain("accepts_remote_config: true");
      expect(script).toContain("validate_config: true");
      expect(script).toContain("automatic_config_rollback: true");
      expect(script).toContain("reports_health: true");
    }
  });

  test("only the service may read the file that holds the key", () => {
    expect(SH.indexOf("umask 077")).toBeLessThan(
      SH.indexOf('cat >"$CONFIG_FILE" <<EOF'),
    );
    expect(SH).toContain('chmod 0600 "$CONFIG_FILE"');
    expect(PS1).toContain(
      '& icacls.exe $DataDir /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F"',
    );
  });

  test("the key is never printed", () => {
    const SH_PRINTS: RegExp = /^\s*(say|printf|echo)\b/;
    const PS1_PRINTS: RegExp = /^\s*Write-Host\b/;

    for (const line of SH.split("\n")) {
      if (SH_PRINTS.test(line)) {
        expect(line).not.toContain("INGESTION_KEY");
      }
    }
    for (const line of PS1.split("\n")) {
      if (PS1_PRINTS.test(line)) {
        expect(line).not.toContain("$Key");
      }
    }
  });

  test("a collector installed by hand is stopped only when asked", () => {
    expect(SH).toContain('if [ "$REPLACE_EXISTING" = "true" ]; then');
    expect(SH).toContain("systemctl disable --now otelcol-contrib");
    expect(PS1).toContain("if ($ReplaceExisting) {");
    expect(PS1).toContain(
      'Set-Service -Name "otelcol-contrib" -StartupType Disabled',
    );
  });

  test("the Windows installer never closes the PowerShell it runs in", () => {
    for (const line of PS1.split("\n")) {
      expect(line).not.toMatch(/^\s*exit\b/);
    }
  });
});

describe("the options they take", () => {
  const SH_OPTIONS: Array<string> = [
    "--url",
    "--key",
    "--label",
    "--env",
    "--version",
    "--download-url",
    "--proxy",
    "--replace-existing",
    "--uninstall",
  ];

  const PS1_PARAMETERS: Array<string> = [
    "$Url",
    "$Key",
    "$Label",
    "$EnvVar",
    "$Version",
    "$DownloadUrl",
    "$Proxy",
    "$ReplaceExisting",
    "$Uninstall",
  ];

  test("install.sh reads each option, and documents it", () => {
    for (const option of SH_OPTIONS) {
      expect(SH).toMatch(new RegExp(`^\\s+${option}\\)$`, "m"));
      expect(SH).toMatch(new RegExp(`^#\\s+${option}\\b`, "m"));
    }
  });

  test("install.ps1 has each parameter, and documents it", () => {
    const params: string = PS1.substring(
      PS1.indexOf("param("),
      PS1.indexOf(")\n\n$ErrorActionPreference"),
    );

    for (const parameter of PS1_PARAMETERS) {
      expect(params).toContain(parameter);
      expect(PS1).toMatch(
        new RegExp(`^\\s+-${parameter.substring(1)}\\b`, "m"),
      );
    }
  });
});

describe("install.sh checks what it is given before anything needs root", () => {
  test("a run that passes every check stops at root, and installs nothing", () => {
    const run: Run = runInstaller([
      "--url",
      "https://oneuptime.example.com/",
      "--key",
      "a1b2c3d4-0000-4000-8000-00000000f00d",
      "--label",
      "env=production",
      "--label",
      "team:web platform",
      "--env",
      "DB_PASSWORD=s3cret with spaces",
    ]);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("Run this as root");
  });

  test("the command the Dashboard shows passes every check", () => {
    const command: string = getHostCollectorShellInstallCommand({
      oneuptimeUrl: "https://oneuptime.example.com",
      ingestionKey: "a1b2c3d4-0000-4000-8000-00000000f00d",
      labels: [
        { key: "env", value: "production" },
        { key: "owner", value: "ops@example.com" },
      ],
      replaceExisting: true,
    });

    // The arguments sh would hand the installer.
    const args: Array<string> = command
      .substring(command.indexOf("sudo sh -s -- ") + "sudo sh -s -- ".length)
      .split(" ");

    const run: Run = runInstaller(args);
    expect(run.stderr).toContain("Run this as root");
  });

  test.each([
    [[], "--url is required"],
    [["--url", "https://oneuptime.example.com"], "--key is required"],
    [
      ["--url", "ftp://oneuptime.example.com", "--key", "k"],
      "--url must be an http:// or https:// address",
    ],
    [
      ["--url", "https://one uptime.example.com", "--key", "k"],
      "--url must be an http:// or https:// address",
    ],
    [
      ["--url", "https://oneuptime.example.com", "--key", "it's"],
      "--key does not look like an ingestion key",
    ],
    [
      [
        "--url",
        "https://oneuptime.example.com",
        "--key",
        "k",
        "--label",
        "no good=x",
      ],
      "is not a label this installer takes",
    ],
    [
      [
        "--url",
        "https://oneuptime.example.com",
        "--key",
        "k",
        "--label",
        "env=$(id)",
      ],
      "is not a label this installer takes",
    ],
    [
      [
        "--url",
        "https://oneuptime.example.com",
        "--key",
        "k",
        "--env",
        "NOVALUE",
      ],
      "must be NAME=VALUE",
    ],
    [
      [
        "--url",
        "https://oneuptime.example.com",
        "--key",
        "k",
        "--env",
        "1BAD=x",
      ],
      "must be NAME=VALUE",
    ],
    [
      [
        "--url",
        "https://oneuptime.example.com",
        "--key",
        "k",
        "--env",
        "ONEUPTIME_INGESTION_KEY=x",
      ],
      "is set by the installer from --url and --key",
    ],
    [
      [
        "--url",
        "https://oneuptime.example.com",
        "--key",
        "k",
        "--version",
        "latest",
      ],
      "--version must be a release number",
    ],
    [
      [
        "--url",
        "https://oneuptime.example.com",
        "--key",
        "k",
        "--download-url",
        "file:///tmp",
      ],
      "--download-url must be an http:// or https:// address",
    ],
    [
      [
        "--url",
        "https://oneuptime.example.com",
        "--key",
        "k",
        "--proxy",
        "socks5://proxy:1080",
      ],
      "--proxy must be an http:// or https:// address",
    ],
    [["--bogus"], "Unknown option: --bogus"],
    [["--url"], "--url needs a value."],
  ])("%p is refused: %s", (args: Array<string>, message: string) => {
    const run: Run = runInstaller(args);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain(message);
    expect(run.stderr).not.toContain("Run this as root");
  });

  test("--uninstall needs root too, and removes nothing without it", () => {
    const run: Run = runInstaller(["--uninstall"]);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("Run this as root");
    expect(run.stdout).not.toContain("Removing");
  });

  test("--help prints how to use it", () => {
    const run: Run = runInstaller(["--help"]);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain(
      "Usage: install.sh --url <OneUptime URL> --key <ingestion key>",
    );
  });
});

describe("install.sh's checks agree with the Dashboard's", () => {
  const KEYS: Array<string> = [
    "env",
    "k8s.cluster",
    "team_name",
    "a-b",
    "A1",
    "-env",
    "_env",
    ".env",
    "my env",
    "env:x",
    "env=x",
    "é",
    "k".repeat(64),
    "k".repeat(65),
  ];

  const VALUES: Array<string> = [
    "production",
    "web platform",
    "ops@example.com",
    "a/b:c",
    "1.2.3",
    "-x",
    " x",
    "x ",
    "it's",
    "$(id)",
    "a;b",
    'quo"te',
    "v".repeat(128),
    "v".repeat(129),
  ];

  test("a label key is one in both places, or in neither", () => {
    const results: Array<string> = runHelpers(
      KEYS.map((key: string): string => {
        return `if is_label_key ${shellQuote(key)}; then echo yes; else echo no; fi`;
      }).join("\n"),
    )
      .trim()
      .split("\n");

    expect(results).toEqual(
      KEYS.map((key: string): string => {
        return isHostCollectorLabelKey(key) ? "yes" : "no";
      }),
    );
  });

  test("a label value is one in both places, or in neither", () => {
    const results: Array<string> = runHelpers(
      VALUES.map((value: string): string => {
        return `if is_label_value ${shellQuote(value)}; then echo yes; else echo no; fi`;
      }).join("\n"),
    )
      .trim()
      .split("\n");

    expect(results).toEqual(
      VALUES.map((value: string): string => {
        return isHostCollectorLabelValue(value) ? "yes" : "no";
      }),
    );
  });

  test("a value written into the supervisor's YAML is quoted as YAML reads it", () => {
    expect(
      runHelpers(
        [
          `yaml_quote 'plain'; echo`,
          `yaml_quote 'a "quoted" word'; echo`,
          `yaml_quote 'back\\slash'; echo`,
        ].join("\n"),
      ),
    ).toBe('"plain"\n"a \\"quoted\\" word"\n"back\\\\slash"\n');
  });

  test("a URL loses the slashes it ends with", () => {
    expect(
      runHelpers(`trim_url 'https://oneuptime.example.com///'; echo`),
    ).toBe("https://oneuptime.example.com\n");
  });
});

/*
 * After it starts the service, install.sh waits up to a minute for the
 * supervisor's first config, reading the supervisor's log for an answer
 * that will not change on its own: a refused key (401, 403, 422), or 404 -
 * nothing at the address it asks answers as OneUptime. Each gets its own
 * explanation instead of "OneUptime has not answered yet", which sent
 * people to check a network that was fine. opamp-go logs every such
 * answer as "invalid response from server: <status>" and asks again on its
 * next poll, so the collector stays installed and connects once it is
 * fixed.
 */
describe("what install.sh tells people when OneUptime turns the supervisor away", () => {
  // install.sh's helpers, with refused_status reading `log` as this run's log.
  function readRefusal(log: string): string {
    const logDir: string = fs.mkdtempSync(
      path.join(os.tmpdir(), "host-collector-log-"),
    );

    try {
      fs.writeFileSync(path.join(logDir, "collector.log"), log);

      return runHelpers(
        [`OS=darwin`, `LOG_DIR=${shellQuote(logDir)}`, `refused_status`].join(
          "\n",
        ),
      );
    } finally {
      fs.rmSync(logDir, { recursive: true, force: true });
    }
  }

  const SUPERVISOR: string =
    '2026-11-13T09:00:00.000Z\terror\topamp-client\t{"error": "invalid response from server: %s"}';

  test.each([["401"], ["403"], ["422"], ["404"]])(
    "reads HTTP %s from the supervisor's log",
    (status: string) => {
      expect(readRefusal(`${SUPERVISOR.replace("%s", status)}\n`)).toBe(status);
    },
  );

  test.each([
    ["an empty log", ""],
    [
      "a busy OneUptime, which it retries",
      "error\topamp-client\tFailed to do HTTP request (server response code=503), will retry\n",
    ],
    [
      "a name that does not resolve",
      'error\tFailed to connect to the OpAMP server\t{"error": "Post \\"https://oneuptime.example.com/telemetry/opamp/v1\\": dial tcp: lookup oneuptime.example.com: no such host"}\n',
    ],
    ["a server error", `${SUPERVISOR.replace("%s", "500")}\n`],
  ])("reads no refusal from %s", (_label: string, log: string) => {
    expect(readRefusal(log)).toBe("");
  });

  test("on Linux it reads this run of the service only", () => {
    const bin: string = fs.mkdtempSync(path.join(os.tmpdir(), "journalctl-"));

    try {
      // Answers 404 for this run's invocation, 401 for any other read.
      fs.writeFileSync(
        path.join(bin, "journalctl"),
        [
          "#!/bin/sh",
          'if [ "$1" = "_SYSTEMD_INVOCATION_ID=run-2" ]; then',
          `  echo '${SUPERVISOR.replace("%s", "404")}'`,
          "else",
          `  echo '${SUPERVISOR.replace("%s", "401")}'`,
          "fi",
        ].join("\n"),
        { mode: 0o755 },
      );

      expect(
        runHelpers(
          [
            `PATH=${shellQuote(bin)}:"$PATH"`,
            "OS=linux",
            "SERVICE_NAME=oneuptime-collector",
            "INVOCATION_ID=run-2",
            "refused_status",
          ].join("\n"),
        ),
      ).toBe("404");
    } finally {
      fs.rmSync(bin, { recursive: true, force: true });
    }
  });

  /*
   * The wait itself, as install.sh runs it: its helpers, then the end of
   * main() from "Waiting for OneUptime", with refused_status answering
   * `refusal` and sleep not waiting.
   */
  function runWait(refusal: string, connected: boolean = false): Run {
    const helpers: string = SH.substring(0, SH.indexOf("\nmain() {"));
    const waitStart: number = SH.indexOf(
      '    say "Waiting for OneUptime to send this host its config..."',
    );
    const waitEnd: number = SH.indexOf('\n}\n\nmain "$@"');

    expect(waitStart).toBeGreaterThan(0);
    expect(waitEnd).toBeGreaterThan(waitStart);

    const stateDir: string = fs.mkdtempSync(
      path.join(os.tmpdir(), "host-collector-state-"),
    );

    try {
      if (connected) {
        fs.writeFileSync(
          path.join(stateDir, "last_recv_remote_config.dat"),
          "",
        );
      }

      const result: SpawnSyncReturns<string> = spawnSync(
        "sh",
        [
          "-c",
          [
            helpers,
            `refused_status() { printf '%s' ${shellQuote(refusal)}; }`,
            "sleep() { :; }",
            "ONEUPTIME_URL='https://oneuptime.example.com'",
            'OPAMP_URL="$ONEUPTIME_URL$OPAMP_PATH"',
            `STATE_DIR=${shellQuote(stateDir)}`,
            "LOGS_COMMAND='sudo journalctl -u oneuptime-collector -n 50'",
            SH.substring(waitStart, waitEnd),
          ].join("\n"),
        ],
        { encoding: "utf8", timeout: 20000 },
      );

      return {
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  }

  test("a 404 says OneUptime is not at the address the collector asks, and what to check", () => {
    const run: Run = runWait("404");
    const address: string = `https://oneuptime.example.com${HOST_COLLECTOR_OPAMP_PATH}`;

    expect(run.status).toBe(1);
    expect(run.stderr).toBe("");
    expect(run.stdout).toContain(
      `OneUptime was not found at ${address} (HTTP 404).`,
    );
    expect(run.stdout).toContain(
      "That is where the collector asks for its config. Check that --url is the address you open",
    );
    expect(run.stdout).toContain(
      "OneUptime at, such as https://oneuptime.com, with nothing after it.",
    );
    expect(run.stdout).toContain(
      `have it send ${HOST_COLLECTOR_OPAMP_PATH} to OneUptime, as it does /otlp.`,
    );
    expect(run.stdout).toContain(
      "The collector stays installed and asks again every 30 seconds.",
    );
    // Not a key refusal, and not a network to go and check.
    expect(run.stdout).not.toContain("refused the key");
    expect(run.stdout).not.toContain("has not answered yet");
  });

  test.each([["401"], ["403"], ["422"]])(
    "HTTP %s still says OneUptime refused the key",
    (status: string) => {
      const run: Run = runWait(status);

      expect(run.status).toBe(1);
      expect(run.stdout).toContain(
        `OneUptime refused the key (HTTP ${status}).`,
      );
      expect(run.stdout).not.toContain("was not found");
    },
  );

  test("no answer yet still says to check the host can reach OneUptime", () => {
    const run: Run = runWait("");

    expect(run.status).toBe(0);
    expect(run.stdout).toContain(
      "The collector is installed and running, but OneUptime has not answered yet.",
    );
    expect(run.stdout).toContain(
      "Check that this host can reach https://oneuptime.example.com",
    );
  });

  test("a config from OneUptime says the host is connected", () => {
    const run: Run = runWait("", true);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("is connected to OneUptime");
  });

  test("install.ps1 tells a 404 apart the same way", () => {
    expect(PS1).toContain(
      'foreach ($status in @("401", "403", "422", "404")) {',
    );

    const wait: string = PS1.substring(
      PS1.indexOf(
        'Write-Host "Waiting for OneUptime to send this host its config..."',
      ),
    );
    const notFound: number = wait.indexOf('if ($refusal -eq "404") {');
    const refused: number = wait.indexOf("if ($refusal) {");

    // Read before the key refusals, which every other status is.
    expect(notFound).toBeGreaterThan(0);
    expect(notFound).toBeLessThan(refused);

    const branch: string = wait.substring(notFound, refused);

    expect(branch).toContain(
      'Write-Host "OneUptime was not found at $Url$OpAmpPath (HTTP 404)."',
    );
    expect(branch).toContain(
      'Write-Host "That is where the collector asks for its config. Check that -Url is the address you open"',
    );
    expect(branch).toContain(
      'Write-Host "of yours sits in front of OneUptime, have it send $OpAmpPath to OneUptime, as it does /otlp."',
    );
    expect(branch).toContain(
      'Write-Host "The collector stays installed and asks again every 30 seconds."',
    );
    expect(branch).toContain(
      'Stop-WithError "OneUptime was not found at $Url$OpAmpPath (HTTP 404)."',
    );
  });
});
