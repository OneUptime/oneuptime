import * as path from "path";

/*
 * Scripts/SmokeTestPackage.js on Windows (#4900's follow-ups). It ran npm
 * as `npm` and the installed CLI as <prefix>/bin/oneuptime, so on Windows it
 * died before a check: npm is npm.cmd there, which execFile cannot start
 * without a shell (Node.js refuses since CVE-2024-27980), and a global
 * install puts the command at <prefix>\oneuptime.cmd and the package under
 * <prefix>\node_modules, with no bin\ or lib\. Node.js reads the home from
 * USERPROFILE there, so `login` wrote outside the empty install.
 *
 * Packing and installing for real runs in PackagedCli on this platform;
 * these hold what the script does on each platform, Windows included,
 * without one.
 */

interface CommandLine {
  command: string;
  args: Array<string>;
  shell: boolean;
}

interface SmokePlatformModule {
  COMMAND_NAME: string;
  PACKAGE_NAME: string;
  cleanEnvironment: (
    overrides?: Record<string, string>,
  ) => Record<string, string | undefined>;
  homeVariables: (home: string) => Record<string, string>;
  npmCommand: (context?: {
    platform?: string;
    execPath?: string;
    env?: Record<string, string | undefined>;
    exists?: (file: string) => boolean;
  }) => CommandLine;
  quoteForCmd: (argument: string) => string;
  globalInstallLayout: (
    prefix: string,
    platform?: string,
  ) => { binary: string; packageDirectory: string };
  cliCommand: (
    binary: string,
    args: Array<string>,
    platform?: string,
  ) => CommandLine;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const Smoke: SmokePlatformModule = require("../Scripts/SmokeTestPackage");

const WINDOWS_NODE: string = "C:\\Program Files\\nodejs\\node.exe";
const WINDOWS_NPM: string =
  "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";
const LINUX_NODE: string = "/usr/local/bin/node";
const LINUX_NPM: string = "/usr/local/lib/node_modules/npm/bin/npm-cli.js";

// A file system that holds only these files.
function only(...files: Array<string>): (file: string) => boolean {
  return (file: string): boolean => {
    return files.includes(file);
  };
}

describe("where a global install puts the CLI", () => {
  it("on Windows: <prefix>\\oneuptime.cmd, and the package under <prefix>\\node_modules", () => {
    expect(
      Smoke.globalInstallLayout("C:\\Temp\\smoke\\prefix", "win32"),
    ).toEqual({
      binary: "C:\\Temp\\smoke\\prefix\\oneuptime.cmd",
      packageDirectory:
        "C:\\Temp\\smoke\\prefix\\node_modules\\@oneuptime\\cli",
    });
  });

  it.each(["linux", "darwin"])(
    "on %s: <prefix>/bin/oneuptime, and the package under <prefix>/lib/node_modules",
    (platform: string) => {
      expect(Smoke.globalInstallLayout("/tmp/smoke/prefix", platform)).toEqual({
        binary: "/tmp/smoke/prefix/bin/oneuptime",
        packageDirectory: "/tmp/smoke/prefix/lib/node_modules/@oneuptime/cli",
      });
    },
  );

  it("on this platform, by default", () => {
    const prefix: string = path.join("smoke", "prefix");

    expect(Smoke.globalInstallLayout(prefix)).toEqual(
      Smoke.globalInstallLayout(prefix, process.platform),
    );
  });
});

describe("how npm is run", () => {
  it("on Windows: Node.js with npm's entry point beside it, never npm.cmd", () => {
    expect(
      Smoke.npmCommand({
        platform: "win32",
        execPath: WINDOWS_NODE,
        env: {},
        exists: only(WINDOWS_NPM),
      }),
    ).toEqual({ command: WINDOWS_NODE, args: [WINDOWS_NPM], shell: false });
  });

  it("elsewhere: Node.js with npm's entry point under ../lib", () => {
    expect(
      Smoke.npmCommand({
        platform: "linux",
        execPath: LINUX_NODE,
        env: {},
        exists: only(LINUX_NPM),
      }),
    ).toEqual({ command: LINUX_NODE, args: [LINUX_NPM], shell: false });
  });

  it("the npm that `npm run` names comes first", () => {
    const nvm: string =
      "C:\\Users\\ada\\AppData\\Roaming\\nvm\\v22.11.0\\node_modules\\npm\\bin\\npm-cli.js";

    expect(
      Smoke.npmCommand({
        platform: "win32",
        execPath: WINDOWS_NODE,
        env: { npm_execpath: nvm },
        exists: only(nvm, WINDOWS_NPM),
      }).args,
    ).toEqual([nvm]);
  });

  it("another package manager's entry point is not npm", () => {
    const yarn: string = "/usr/local/lib/node_modules/yarn/bin/yarn.js";

    expect(
      Smoke.npmCommand({
        platform: "linux",
        execPath: LINUX_NODE,
        env: { npm_execpath: yarn },
        exists: only(yarn, LINUX_NPM),
      }).args,
    ).toEqual([LINUX_NPM]);
  });

  it("with no entry point to find, npm from PATH: through cmd.exe on Windows", () => {
    expect(
      Smoke.npmCommand({
        platform: "win32",
        execPath: WINDOWS_NODE,
        env: {},
        exists: only(),
      }),
    ).toEqual({ command: "npm.cmd", args: [], shell: true });
    expect(
      Smoke.npmCommand({
        platform: "linux",
        execPath: LINUX_NODE,
        env: {},
        exists: only(),
      }),
    ).toEqual({ command: "npm", args: [], shell: false });
  });

  it("finds npm's entry point on this machine, so packing and installing need no shell", () => {
    const npm: CommandLine = Smoke.npmCommand();

    expect(npm.command).toBe(process.execPath);
    expect(npm.args).toHaveLength(1);
    expect(path.basename(npm.args[0] as string)).toBe("npm-cli.js");
    expect(npm.shell).toBe(false);
  });
});

describe("how the installed CLI is run", () => {
  it("on Windows: its batch file through cmd.exe, the path and the arguments quoted for it", () => {
    expect(
      Smoke.cliCommand(
        "C:\\Users\\Ada Lovelace\\Temp\\prefix\\oneuptime.cmd",
        [
          "login",
          "sk-smoke-test-0123456789",
          "https://oneuptime.example.com",
          "--output",
          "json",
          "two words",
        ],
        "win32",
      ),
    ).toEqual({
      command: '"C:\\Users\\Ada Lovelace\\Temp\\prefix\\oneuptime.cmd"',
      args: [
        "login",
        "sk-smoke-test-0123456789",
        "https://oneuptime.example.com",
        "--output",
        "json",
        '"two words"',
      ],
      shell: true,
    });
  });

  it("elsewhere: the command itself, its arguments as they are", () => {
    expect(
      Smoke.cliCommand("/tmp/prefix/bin/oneuptime", ["two words"], "linux"),
    ).toEqual({
      command: "/tmp/prefix/bin/oneuptime",
      args: ["two words"],
      shell: false,
    });
  });
});

describe("an argument for cmd.exe", () => {
  it.each([
    "--version",
    "http://127.0.0.1:53211",
    "C:\\Temp\\cli.tgz",
    "sk-smoke-test-0123456789",
    "@oneuptime/cli",
  ])("%s goes as it is", (argument: string) => {
    expect(Smoke.quoteForCmd(argument)).toBe(argument);
  });

  it.each([
    ["C:\\Users\\Ada Lovelace\\cli.tgz", '"C:\\Users\\Ada Lovelace\\cli.tgz"'],
    ["a&b", '"a&b"'],
    ["a|b", '"a|b"'],
    ["a<b>c", '"a<b>c"'],
    ["a^b", '"a^b"'],
    ["a,b", '"a,b"'],
    ["a=b", '"a=b"'],
    ["", '""'],
  ])("%s is quoted", (argument: string, quoted: string) => {
    expect(Smoke.quoteForCmd(argument)).toBe(quoted);
  });

  it.each(['say "hi"', "100%", "two\nlines", "two\rlines"])(
    "%j cannot reach a batch file whole, so it is refused",
    (argument: string) => {
      expect(() => {
        return Smoke.quoteForCmd(argument);
      }).toThrow("cannot be passed through cmd.exe unchanged");
    },
  );
});

describe("the environment npm and the CLI run with", () => {
  it("gives the empty home as HOME and as USERPROFILE, which Node.js reads on Windows", () => {
    expect(Smoke.homeVariables("C:\\Temp\\home")).toEqual({
      HOME: "C:\\Temp\\home",
      USERPROFILE: "C:\\Temp\\home",
    });
  });

  it("replaces a variable whatever its case, so Windows sees one of each", () => {
    const saved: NodeJS.ProcessEnv = { ...process.env };

    try {
      process.env["UserProfile"] = "C:\\Users\\ada";
      process.env["Home"] = "C:\\Users\\ada";

      const environment: Record<string, string | undefined> =
        Smoke.cleanEnvironment(Smoke.homeVariables("C:\\Temp\\home"));
      const homes: Array<string> = Object.keys(environment).filter(
        (key: string): boolean => {
          return ["HOME", "USERPROFILE"].includes(key.toUpperCase());
        },
      );

      expect(homes.sort()).toEqual(["HOME", "USERPROFILE"]);
      expect(environment["HOME"]).toBe("C:\\Temp\\home");
      expect(environment["USERPROFILE"]).toBe("C:\\Temp\\home");
    } finally {
      for (const name of Object.keys(process.env)) {
        if (!(name in saved)) {
          delete process.env[name];
        }
      }

      Object.assign(process.env, saved);
    }
  });
});
