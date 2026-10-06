import {
  getApiKeysStoppedMessage,
  getPlanCutoffMessage,
  getScimStoppedMessage,
  isPlanCutoffCredentialTable,
  PLAN_CUTOFF_CREDENTIAL_TABLES,
  PlanCutoffCredential,
} from "../../../Types/Billing/PlanCutoffCredentials";
import ApiKey from "../../../Models/DatabaseModels/ApiKey";
import ApiKeyPermission from "../../../Models/DatabaseModels/ApiKeyPermission";
import ProjectSCIM from "../../../Models/DatabaseModels/ProjectSCIM";
import ProjectSso from "../../../Models/DatabaseModels/ProjectSso";
import StatusPageSCIM from "../../../Models/DatabaseModels/StatusPageSCIM";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import { describe, expect, test } from "@jest/globals";

/*
 * The credentials that stop working below their plan, and what a caller is
 * told when one is refused. The table names are the server's and the
 * Dashboard's one list: the API-key and SCIM middleware refuse these, and
 * the Dashboard's below-plan view of these says they stopped.
 */

describe("the credentials that stop below their plan", () => {
  test("are exactly the project's API keys and its SCIM connections, project and status page", () => {
    expect([...PLAN_CUTOFF_CREDENTIAL_TABLES]).toEqual([
      "ApiKey",
      "ProjectSCIM",
      "StatusPageSCIM",
    ]);
  });

  test("are named by the models' own table names", () => {
    expect(new ApiKey().tableName).toBe(PlanCutoffCredential.ApiKey);
    expect(new ProjectSCIM().tableName).toBe(PlanCutoffCredential.ProjectSCIM);
    expect(new StatusPageSCIM().tableName).toBe(
      PlanCutoffCredential.StatusPageSCIM,
    );
  });

  test.each([
    ["ApiKey", true],
    ["ProjectSCIM", true],
    ["StatusPageSCIM", true],
  ])("%s is one", (tableName: string, expected: boolean) => {
    expect(isPlanCutoffCredentialTable(tableName)).toBe(expected);
  });

  /*
   * Single sign-on keeps signing people in below its plan, and an API key's
   * permissions are not a credential: they are what a key may do. Telemetry
   * ingestion keys are not a project's API keys at all.
   */
  test.each([
    [new ProjectSso().tableName],
    [new ApiKeyPermission().tableName],
    [new TelemetryIngestionKey().tableName],
    ["apikey"],
    [""],
  ])("%s is not", (tableName: string | undefined) => {
    expect(isPlanCutoffCredentialTable(tableName)).toBe(false);
  });

  test("nothing is not", () => {
    expect(isPlanCutoffCredentialTable(undefined)).toBe(false);
    expect(isPlanCutoffCredentialTable(null)).toBe(false);
  });
});

describe("what a refused API key request is told", () => {
  const message: string = getApiKeysStoppedMessage("Growth");

  test("is one plain message", () => {
    expect(message).toBe(
      "API keys need the Growth plan. This project's plan does not include them, so its API keys stopped working. The keys are kept: upgrade the project to Growth in Project Settings > Billing and they work again.",
    );
  });

  test("names the plan the keys need, twice: what they need and what to move to", () => {
    expect(message.match(/Growth/g)).toHaveLength(2);
  });

  test("says the keys are kept and work again, with the one thing to do", () => {
    expect(message).toContain("The keys are kept");
    expect(message).toContain("they work again");
    expect(message).toContain("Project Settings > Billing");
  });

  test("names whatever plan it is given", () => {
    expect(getApiKeysStoppedMessage("Scale")).toContain(
      "API keys need the Scale plan.",
    );
  });
});

describe("what an identity provider is told", () => {
  const message: string = getScimStoppedMessage("Scale");

  test("is one plain message", () => {
    expect(message).toBe(
      "SCIM provisioning needs the Scale plan. This project's plan does not include it, so its SCIM connections stopped working. The connections are kept: upgrade the project to Scale in Project Settings > Billing and they work again.",
    );
  });

  test("says the connections are kept, and where to upgrade", () => {
    expect(message).toContain("The connections are kept");
    expect(message).toContain("upgrade the project to Scale");
    expect(message).toContain("Project Settings > Billing");
  });
});

describe("the message for a kind of credential", () => {
  test("an API key gets the API key message", () => {
    expect(getPlanCutoffMessage(PlanCutoffCredential.ApiKey, "Growth")).toBe(
      getApiKeysStoppedMessage("Growth"),
    );
  });

  test.each([
    [PlanCutoffCredential.ProjectSCIM],
    [PlanCutoffCredential.StatusPageSCIM],
  ])("%s gets the SCIM message", (credential: PlanCutoffCredential) => {
    expect(getPlanCutoffMessage(credential, "Scale")).toBe(
      getScimStoppedMessage("Scale"),
    );
  });
});
