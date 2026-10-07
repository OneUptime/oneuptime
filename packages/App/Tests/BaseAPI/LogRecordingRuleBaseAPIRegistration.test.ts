import LogRecordingRule from "Common/Models/DatabaseModels/LogRecordingRule";
import { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AllModelTypes from "Common/Models/DatabaseModels/Index";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Log recording rules are created, listed, edited and deleted over the
 * generic CRUD API (the dashboard's Logs > Settings > Recording Rules, MCP,
 * Terraform). A model's @CrudApiEndpoint route only answers once
 * BaseAPI/Index.ts mounts `new BaseAPI<Model, ServiceType>(Model, Service)`
 * for it - a model left out there compiles fine and 404s - and the mount must
 * use LogRecordingRuleService, whose hooks validate the definition and make
 * the output metric name. Booting the whole API router here would pull in
 * every service, so the registration is pinned on the source,
 * whitespace-insensitively, the way the other registration tests pin theirs.
 */

const APP_ROOT: string = path.join(__dirname, "../..");

function readBaseApiIndex(): string {
  return fs
    .readFileSync(path.join(APP_ROOT, "FeatureSet/BaseAPI/Index.ts"), "utf8")
    .replace(/\s+/g, "");
}

describe("Log recording rule CRUD API registration", () => {
  const code: string = readBaseApiIndex();

  test("the model is imported with its service and mounted exactly once", () => {
    expect(code).toContain(
      'importLogRecordingRulefrom"Common/Models/DatabaseModels/LogRecordingRule";',
    );
    expect(code).toContain(
      'importLogRecordingRuleService,{ServiceasLogRecordingRuleServiceType,}from"Common/Server/Services/LogRecordingRuleService";',
    );

    const mount: RegExp =
      /newBaseAPI<LogRecordingRule,LogRecordingRuleServiceType>\(LogRecordingRule,LogRecordingRuleService,?\)\.getRouter\(\)/g;

    expect(code.match(mount) || []).toHaveLength(1);
    expect(
      code.split(
        "app.use(`/${APP_NAME.toLocaleLowerCase()}`,newBaseAPI<LogRecordingRule,",
      ).length - 1,
    ).toBe(1);
  });

  test("serves /log-recording-rule, a route no other model answers on", () => {
    expect(new LogRecordingRule().crudApiPath?.toString()).toBe(
      "/log-recording-rule",
    );

    const owners: Array<string> = (
      AllModelTypes as Array<DatabaseBaseModelType>
    )
      .filter((modelType: DatabaseBaseModelType): boolean => {
        return (
          new modelType().crudApiPath?.toString() === "/log-recording-rule"
        );
      })
      .map((modelType: DatabaseBaseModelType): string => {
        return modelType.name;
      });

    expect(owners).toEqual(["LogRecordingRule"]);
  });
});
