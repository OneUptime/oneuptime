import { beforeAll, describe, expect, test } from "@jest/globals";
import path from "path";
import {
  buildFirstLoad,
  FirstLoadBuild,
  inputsUnder,
} from "../Helpers/FirstLoadBuild";

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..");

/*
 * A PAGE THAT DRAWS A MONITOR, WITHOUT EVERY MONITOR TYPE (issue #8821).
 *
 * A status page draws its monitors: each resource on it is a
 * StatusPageResource, whose monitor is a Monitor model. That model's steps
 * column declared its database transformer from MonitorSteps, and so every
 * page with the model downloaded a monitor's steps and criteria with every
 * monitor type - some 147 KB before gzip that only the server, which has
 * the database, runs. A browser build takes MonitorStepsColumnTransformer's
 * browser file in its place (packages/Common/package.json's "browser"
 * field), which needs none of them, and JSON reading no longer imports them
 * either (Types/JoinedSerializableObjects).
 *
 * Built as the status page builds (the shared esbuild config, for
 * production), with the models a status page reads and JSON reading as the
 * entry (Helpers/FirstLoadBuild). JoinedSerializableObjects.test.ts holds
 * the same models in Node, where they still bring them.
 */

const MODELS: ReadonlyArray<string> = [
  "Models/DatabaseModels/Monitor",
  "Models/DatabaseModels/MonitorTemplate",
  "Models/DatabaseModels/MonitorTest",
  "Models/DatabaseModels/StatusPageResource",
  "Types/JSONFunctions",
];

const NOT_BUILT: ReadonlyArray<[string, string]> = [
  ["a monitor's steps", "Types/Monitor/MonitorSteps.ts"],
  ["a monitor's step", "Types/Monitor/MonitorStep.ts"],
  ["a step's criteria", "Types/Monitor/MonitorCriteria.ts"],
  ["a criterion", "Types/Monitor/MonitorCriteriaInstance.ts"],
  [
    "the steps column's transformer for the server",
    "Types/Monitor/MonitorStepsColumnTransformer.ts",
  ],
  [
    "the monitor types a step's settings bring",
    "Types/Monitor/MonitorStepLogMonitor.ts",
  ],
];

let built: FirstLoadBuild | null = null;

beforeAll(() => {
  built = buildFirstLoad({
    entryLines: MODELS.map((module: string, index: number): string => {
      return `export { default as Module${index} } from ${JSON.stringify(
        path.join(COMMON_ROOT, module),
      )};`;
    }),
    serviceName: "StatusPage",
    publicPath: "/status-page/dist/",
  });
}, 300000);

describe("a browser build of the models a status page reads", () => {
  test.each(
    MODELS.map((module: string): [string] => {
      return [module];
    }),
  )("has %s in its first load", (module: string) => {
    expect(inputsUnder(built!.firstLoad, `${module}.ts`).length).toBe(1);
  });

  test("declares the steps column with the browser's transformer, which needs no monitor type", () => {
    expect(
      inputsUnder(
        built!.firstLoad,
        "Types/Monitor/MonitorStepsColumnTransformer.browser.ts",
      ).length,
    ).toBe(1);
  });

  test.each(NOT_BUILT)(
    "does not build %s at all",
    (_name: string, file: string) => {
      expect(
        inputsUnder([...built!.firstLoad, ...built!.loadedLater], file),
      ).toEqual([]);
    },
  );
});
