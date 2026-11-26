import { beforeAll, describe, expect, test } from "@jest/globals";
import path from "path";
import {
  buildFirstLoad,
  FirstLoadBuild,
  inputsUnder,
} from "../Helpers/FirstLoadBuild";

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..");

/*
 * A PAGE THAT READS A MODEL, WITH NO MODULE WRAPPED TO RUN LATER (#10290).
 *
 * Every record keeps who last changed it, a relation to User that the base
 * model reads when it is first resolved: User extends the base model, so it
 * is never imported at its top. It was read with require("../User"), and a
 * module that is require()d, the bundler runs only when it is first asked
 * for - and so every module it imports, wrapped one by one: User's are most
 * of Common, down to every file of typeorm. Each public page downloaded
 * those wrappers before it could draw: 8.6 KiB gzipped of a sign-in page,
 * 11.8 KiB of a status page and 13 KiB of a public dashboard
 * (packages/Common/Scripts/first-load-budgets.js).
 *
 * A browser build takes UserModelType.browser.ts in place of the server's
 * UserModelType.ts (packages/Common/package.json's "browser" field), which
 * requires nothing: User says it is the User model as it loads.
 *
 * Built as the sign-in pages build (the shared esbuild config, for
 * production), with User and a model that names it as the entry
 * (Helpers/FirstLoadBuild). UserModelType.test.ts holds both halves in Node.
 */
const MODELS: ReadonlyArray<string> = [
  "Models/DatabaseModels/User",
  "Models/DatabaseModels/Label",
];

let built: FirstLoadBuild | null = null;

beforeAll(() => {
  built = buildFirstLoad({
    entryLines: MODELS.map((module: string, index: number): string => {
      return `export { default as Module${index} } from ${JSON.stringify(
        path.join(COMMON_ROOT, module),
      )};`;
    }),
    serviceName: "Accounts",
    publicPath: "/accounts/dist/",
  });
}, 300000);

describe("a browser build of the models", () => {
  test("has User, and the base model, in its first load", () => {
    expect(
      inputsUnder(built!.firstLoad, "Models/DatabaseModels/User.ts").length,
    ).toBe(1);
    expect(
      inputsUnder(
        built!.firstLoad,
        "Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel.ts",
      ).length,
    ).toBe(1);
  });

  test("reads who last changed a record through the browser's twin", () => {
    expect(
      inputsUnder(
        built!.firstLoad,
        "Models/DatabaseModels/DatabaseBaseModel/UserModelType.browser.ts",
      ).length,
    ).toBe(1);
  });

  test("does not build the server's half, which requires User", () => {
    expect(
      inputsUnder(
        [...built!.firstLoad, ...built!.loadedLater],
        "Models/DatabaseModels/DatabaseBaseModel/UserModelType.ts",
      ),
    ).toEqual([]);
  });

  test("requires none of OneUptime's own modules, so none is wrapped to run later", () => {
    expect(built!.requiredByOwnCode).toEqual([]);
  });
});
