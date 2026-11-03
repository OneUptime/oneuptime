import * as fs from "fs";
import * as os from "os";

/*
 * Before each test file: a home of its own (see ThrowawayHomes.ts), made in
 * the run's folder of throwaway homes when the factory first runs - so one
 * file's logins never meet another's. Node's os.homedir() reads the
 * process's real environment, which a test file's process.env only copies,
 * so os is replaced for the file with one whose homedir() answers that home;
 * HOME and USERPROFILE say it too. A file that mocks os itself replaces
 * this for itself.
 */
jest.mock("os", () => {
  const actualOs: typeof import("os") = jest.requireActual("os");
  const actualFs: typeof import("fs") = jest.requireActual("fs");
  const actualPath: typeof import("path") = jest.requireActual("path");
  const { HOMES_VARIABLE }: typeof import("./ThrowawayHomes") =
    jest.requireActual("./ThrowawayHomes");
  const homes: string =
    process.env[HOMES_VARIABLE] ||
    actualFs.mkdtempSync(
      actualPath.join(actualOs.tmpdir(), "oneuptime-cli-tests-"),
    );
  const home: string = actualFs.mkdtempSync(actualPath.join(homes, "file-"));

  return {
    ...actualOs,
    homedir: (): string => {
      return home;
    },
  };
});

const home: string = os.homedir();

fs.mkdirSync(home, { recursive: true });
process.env["HOME"] = home;
process.env["USERPROFILE"] = home;
