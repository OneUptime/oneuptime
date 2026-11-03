import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  CLI_FOLDER,
  HOMES_VARIABLE,
  REAL_HOME_SNAPSHOT_FILE,
  REAL_HOME_VARIABLE,
  snapshotOf,
} from "./ThrowawayHomes";

/*
 * Before any suite: a folder of throwaway homes, HOME and USERPROFILE (which
 * Node.js reads on Windows) pointed at one of them, and a note of what the
 * reader's own ~/.oneuptime holds (see ThrowawayHomes.ts). Jest runs this in
 * its own process, before it starts the suites: what it sets in the
 * environment is what every suite, and every process a suite starts, runs
 * with.
 */
export default async function globalSetup(): Promise<void> {
  const realHome: string = os.homedir();
  const homes: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-cli-tests-"),
  );
  const runHome: string = path.join(homes, "run");

  fs.mkdirSync(runHome);
  fs.writeFileSync(
    path.join(homes, REAL_HOME_SNAPSHOT_FILE),
    JSON.stringify(snapshotOf(path.join(realHome, CLI_FOLDER))),
  );

  process.env[REAL_HOME_VARIABLE] = realHome;
  process.env[HOMES_VARIABLE] = homes;
  process.env["HOME"] = runHome;
  process.env["USERPROFILE"] = runHome;
}
