import * as fs from "fs";
import * as path from "path";
import {
  CLI_FOLDER,
  differences,
  EntrySnapshot,
  HOMES_VARIABLE,
  REAL_HOME_SNAPSHOT_FILE,
  REAL_HOME_VARIABLE,
  snapshotOf,
} from "./ThrowawayHomes";

/*
 * After every suite: the run fails if the reader's own ~/.oneuptime changed
 * while it ran - a suite reached past its throwaway home (see
 * ThrowawayHomes.ts) - and the folder of throwaway homes is removed.
 */
export default async function globalTeardown(): Promise<void> {
  const homes: string | undefined = process.env[HOMES_VARIABLE];
  const realHome: string | undefined = process.env[REAL_HOME_VARIABLE];

  if (!homes || !realHome) {
    throw new Error(
      `The CLI's test run has no throwaway homes: ${HOMES_VARIABLE} and ${REAL_HOME_VARIABLE} are set by Tests/Setup/GlobalSetup.ts, which jest.config.json names as its globalSetup.`,
    );
  }

  const before: Array<EntrySnapshot> = JSON.parse(
    fs.readFileSync(path.join(homes, REAL_HOME_SNAPSHOT_FILE), "utf-8"),
  ) as Array<EntrySnapshot>;
  const after: Array<EntrySnapshot> = snapshotOf(
    path.join(realHome, CLI_FOLDER),
  );
  const changes: Array<string> = differences(before, after);

  fs.rmSync(homes, { recursive: true, force: true });

  if (changes.length > 0) {
    throw new Error(
      `${path.join(realHome, CLI_FOLDER)} changed while the CLI's tests ran (${changes.join(
        "; ",
      )}): a test reached past its throwaway home (Tests/Setup/ThrowawayHomes.ts) - or the CLI was used outside the tests meanwhile.`,
    );
  }
}
