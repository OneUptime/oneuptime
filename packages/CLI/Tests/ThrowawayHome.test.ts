import { spawnSync, SpawnSyncReturns } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as ConfigManager from "../Core/ConfigManager";
import {
  CLI_FOLDER,
  differences,
  EntrySnapshot,
  HOMES_VARIABLE,
  REAL_HOME_VARIABLE,
  snapshotOf,
} from "./Setup/ThrowawayHomes";

/*
 * NO CLI TEST TOUCHES THE READER'S OWN ~/.oneuptime.
 *
 * The suites log in, switch contexts and log out, which the CLI keeps in
 * ~/.oneuptime/config.json. They ran in the reader's real home, saving the
 * file and writing it back after, so a run stopped between the two left the
 * reader logged out, and two runs at once traded logins. Every test file
 * now runs in a throwaway home of its own (Tests/Setup/ThrowawayHomes.ts),
 * and the run fails if the real ~/.oneuptime changed (GlobalTeardown.ts).
 * This holds the pieces to that.
 */

const CLI_ROOT: string = path.resolve(__dirname, "..");
const TESTS: string = path.join(CLI_ROOT, "Tests");

function realHome(): string {
  const home: string | undefined = process.env[REAL_HOME_VARIABLE];

  if (!home) {
    throw new Error(
      `${REAL_HOME_VARIABLE} is not set: GlobalSetup did not run`,
    );
  }

  return home;
}

function homes(): string {
  const folder: string | undefined = process.env[HOMES_VARIABLE];

  if (!folder) {
    throw new Error(`${HOMES_VARIABLE} is not set: GlobalSetup did not run`);
  }

  return folder;
}

function isInside(child: string, parent: string): boolean {
  const relative: string = path.relative(parent, child);

  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

// Every test file of the CLI, by its path from Tests/.
function testFiles(): Array<string> {
  const found: Array<string> = [];

  const walk: (folder: string) => void = (folder: string): void => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full: string = path.join(folder, entry.name);

      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".test.ts")) {
        found.push(path.relative(TESTS, full).split(path.sep).join("/"));
      }
    }
  };

  walk(TESTS);

  return found.sort();
}

describe("the CLI's tests run in throwaway homes", () => {
  test("this file's home is a throwaway one, in the run's folder, never the reader's", () => {
    const home: string = os.homedir();

    expect(isInside(home, homes())).toBe(true);
    expect(isInside(homes(), os.tmpdir())).toBe(true);
    expect(home).not.toBe(realHome());
    expect(isInside(home, realHome())).toBe(false);
    expect(path.basename(home).startsWith("file-")).toBe(true);
  });

  test("HOME and USERPROFILE (which Node.js reads on Windows) say this file's home", () => {
    expect(process.env["HOME"]).toBe(os.homedir());
    expect(process.env["USERPROFILE"]).toBe(os.homedir());
  });

  test("a login is saved in the throwaway home, and the reader's ~/.oneuptime is left as it was", () => {
    const realFolder: string = path.join(realHome(), CLI_FOLDER);
    const before: Array<EntrySnapshot> = snapshotOf(realFolder);

    ConfigManager.addContext({
      name: "throwaway-home-check",
      apiUrl: "https://oneuptime.example.com",
      apiKey: "sk-throwaway-home-check",
    });

    const saved: string = path.join(os.homedir(), CLI_FOLDER, "config.json");

    expect(fs.existsSync(saved)).toBe(true);
    expect(ConfigManager.load().contexts["throwaway-home-check"]?.apiKey).toBe(
      "sk-throwaway-home-check",
    );
    expect(differences(before, snapshotOf(realFolder))).toEqual([]);

    ConfigManager.removeContext("throwaway-home-check");
  });

  test("a process a test starts, with the environment it inherits, runs in a throwaway home too", () => {
    const child: SpawnSyncReturns<string> = spawnSync(
      process.execPath,
      ["-e", "process.stdout.write(require('os').homedir())"],
      { encoding: "utf-8" },
    );

    expect(child.status).toBe(0);
    expect(isInside(child.stdout, homes())).toBe(true);
    expect(child.stdout).not.toBe(realHome());
  });

  test("jest.config.json runs the setup and the check: before the run, before each file and after the run", () => {
    const config: {
      globalSetup?: string;
      globalTeardown?: string;
      setupFiles?: Array<string>;
    } = JSON.parse(
      fs.readFileSync(path.join(CLI_ROOT, "jest.config.json"), "utf-8"),
    );

    expect(config.globalSetup).toBe("<rootDir>/Tests/Setup/GlobalSetup.ts");
    expect(config.globalTeardown).toBe(
      "<rootDir>/Tests/Setup/GlobalTeardown.ts",
    );
    expect(config.setupFiles).toContain(
      "<rootDir>/Tests/Setup/ThrowawayHome.ts",
    );
  });

  test("the snapshot sees a file added, changed, touched or removed, and nothing when nothing changed", () => {
    const folder: string = fs.mkdtempSync(
      path.join(os.homedir(), "snapshot-check-"),
    );
    const config: string = path.join(folder, "config.json");

    fs.writeFileSync(config, "{}");

    const first: Array<EntrySnapshot> = snapshotOf(folder);

    expect(differences(first, snapshotOf(folder))).toEqual([]);

    fs.writeFileSync(config, '{"currentContext":"x"}');
    expect(differences(first, snapshotOf(folder))).toEqual([
      "config.json was changed",
    ]);

    const second: Array<EntrySnapshot> = snapshotOf(folder);
    const later: Date = new Date(Date.now() + 60_000);

    fs.utimesSync(config, later, later);
    expect(differences(second, snapshotOf(folder))).toEqual([
      "config.json was changed",
    ]);

    fs.writeFileSync(path.join(folder, "other.json"), "{}");
    fs.unlinkSync(config);
    expect(differences(second, snapshotOf(folder)).sort()).toEqual([
      "config.json was removed",
      "other.json was added",
    ]);

    expect(snapshotOf(path.join(folder, "missing"))).toEqual([]);
  });

  test("no test reaches for the reader's own home", () => {
    const reaching: Array<string> = [];

    for (const file of testFiles()) {
      if (file === "ThrowawayHome.test.ts") {
        continue;
      }

      const source: string = fs.readFileSync(path.join(TESTS, file), "utf-8");

      // os.userInfo() answers the account's home, whatever HOME says.
      if (source.includes("userInfo(")) {
        reaching.push(`${file}: os.userInfo()`);
      }

      if (source.includes(REAL_HOME_VARIABLE)) {
        reaching.push(`${file}: ${REAL_HOME_VARIABLE}`);
      }
    }

    expect(testFiles().length).toBeGreaterThan(10);
    expect(reaching).toEqual([]);
  });
});
