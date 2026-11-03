import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

/*
 * THE HOMES THE CLI'S TESTS RUN IN - NEVER THE READER'S OWN.
 *
 * The CLI keeps its logins in ~/.oneuptime/config.json (Core/ConfigManager),
 * and its suites log in, switch contexts and log out. They used to do it in
 * the real ~/.oneuptime, saving the file's text before and writing it back
 * after: a run that stopped between the two (a Ctrl-C, a crash, a timeout)
 * left the reader logged out, and two runs at once (two worktrees) wrote
 * each other's logins back. Now:
 *
 *   - GlobalSetup.ts (once, before any suite) makes a folder of throwaway
 *     homes under the system's temp folder, points HOME and USERPROFILE at
 *     one of them - so every process the suites start, and any code that
 *     reads the environment, sees it - and notes what the real
 *     ~/.oneuptime holds;
 *   - ThrowawayHome.ts (before each test file) gives that file a home of
 *     its own in the folder: os.homedir() answers it there (Node's os reads
 *     the process's real environment, which a test file's process.env only
 *     copies), and HOME and USERPROFILE say it;
 *   - GlobalTeardown.ts (once, after every suite) fails the run if the real
 *     ~/.oneuptime changed while it ran, and removes the folder.
 *
 * Tests/ThrowawayHome.test.ts holds the three to this. Not a test file
 * itself (jest only collects *.test.ts).
 */

// Where GlobalSetup notes the reader's own home, for the teardown and the guard.
export const REAL_HOME_VARIABLE: string = "ONEUPTIME_CLI_TEST_REAL_HOME";

// The folder of throwaway homes this run made.
export const HOMES_VARIABLE: string = "ONEUPTIME_CLI_TEST_HOMES";

// The file in that folder that holds what the real ~/.oneuptime held.
export const REAL_HOME_SNAPSHOT_FILE: string = "real-home-oneuptime.json";

// The CLI's own folder in a home (Core/ConfigManager's CONFIG_DIR).
export const CLI_FOLDER: string = ".oneuptime";

export interface EntrySnapshot {
  path: string;
  kind: "file" | "folder" | "other";
  size: number;
  modifiedAtMs: number;
  // A file's sha256; empty for a folder.
  sha256: string;
}

export type SnapshotOfFunction = (folder: string) => Array<EntrySnapshot>;

/*
 * What a folder holds, every file and folder under it with its size, time
 * and content hash, in a fixed order: an empty list when the folder does
 * not exist.
 */
export const snapshotOf: SnapshotOfFunction = (
  folder: string,
): Array<EntrySnapshot> => {
  const entries: Array<EntrySnapshot> = [];

  const walk: (current: string) => void = (current: string): void => {
    let stat: fs.Stats;

    try {
      stat = fs.lstatSync(current);
    } catch {
      return;
    }

    const relative: string = path.relative(folder, current) || ".";

    if (stat.isDirectory()) {
      entries.push({
        path: relative,
        kind: "folder",
        size: 0,
        modifiedAtMs: stat.mtimeMs,
        sha256: "",
      });

      for (const name of fs.readdirSync(current).sort()) {
        walk(path.join(current, name));
      }

      return;
    }

    entries.push({
      path: relative,
      kind: stat.isFile() ? "file" : "other",
      size: stat.size,
      modifiedAtMs: stat.mtimeMs,
      sha256: stat.isFile()
        ? crypto
            .createHash("sha256")
            .update(fs.readFileSync(current))
            .digest("hex")
        : "",
    });
  };

  walk(folder);

  return entries;
};

export type DifferencesFunction = (
  before: Array<EntrySnapshot>,
  after: Array<EntrySnapshot>,
) => Array<string>;

// What changed between two snapshots of a folder, one line a change.
export const differences: DifferencesFunction = (
  before: Array<EntrySnapshot>,
  after: Array<EntrySnapshot>,
): Array<string> => {
  const byPath: (
    snapshot: Array<EntrySnapshot>,
  ) => Map<string, EntrySnapshot> = (
    snapshot: Array<EntrySnapshot>,
  ): Map<string, EntrySnapshot> => {
    return new Map(
      snapshot.map((entry: EntrySnapshot): [string, EntrySnapshot] => {
        return [entry.path, entry];
      }),
    );
  };
  const was: Map<string, EntrySnapshot> = byPath(before);
  const is: Map<string, EntrySnapshot> = byPath(after);
  const changes: Array<string> = [];

  for (const [entryPath, entry] of was) {
    const now: EntrySnapshot | undefined = is.get(entryPath);

    if (!now) {
      changes.push(`${entryPath} was removed`);
    } else if (
      now.kind !== entry.kind ||
      now.size !== entry.size ||
      now.sha256 !== entry.sha256 ||
      (entry.kind === "file" && now.modifiedAtMs !== entry.modifiedAtMs)
    ) {
      changes.push(`${entryPath} was changed`);
    }
  }

  for (const entryPath of is.keys()) {
    if (!was.has(entryPath)) {
      changes.push(`${entryPath} was added`);
    }
  }

  return changes.sort();
};
