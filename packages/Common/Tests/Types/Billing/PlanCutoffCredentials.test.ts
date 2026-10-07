import {
  getApiKeysStoppedMessage,
  getCredentialsStoppedByMove,
  getPlanCutoffMessage,
  getScimStoppedMessage,
  isPlanCutoffCredentialTable,
  PLAN_CUTOFF_CREDENTIAL_TABLES,
  PLAN_CUTOFF_CREDENTIALS,
  PlanCutoffCredential,
} from "../../../Types/Billing/PlanCutoffCredentials";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
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

  test("are every kind there is, and their tables are those kinds", () => {
    expect([...PLAN_CUTOFF_CREDENTIALS]).toEqual(
      Object.values(PlanCutoffCredential),
    );
    expect([...PLAN_CUTOFF_CREDENTIAL_TABLES]).toEqual([
      ...PLAN_CUTOFF_CREDENTIALS,
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
  ])("%s is not", (tableName: string | null) => {
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
      "SCIM provisioning needs the Scale plan. This project's plan does not include it, so its SCIM connections can only remove people: requests that add or change people or groups are refused. The connections are kept: upgrade the project to Scale in Project Settings > Billing and they work fully again.",
    );
  });

  /*
   * Below the plan a connection still takes access away (ee's
   * SCIMBelowPlan): the refusal of everything else must not read as if
   * removals stopped too.
   */
  test("says removing people still works, and what is refused", () => {
    expect(message).toContain("can only remove people");
    expect(message).toContain(
      "requests that add or change people or groups are refused",
    );
    expect(message).not.toContain("stopped working");
  });

  test("says the connections are kept, and where to upgrade", () => {
    expect(message).toContain("The connections are kept");
    expect(message).toContain("upgrade the project to Scale");
    expect(message).toContain("Project Settings > Billing");
    expect(message).toContain("they work fully again");
  });
});

/*
 * What a move from one plan to another stops: one rule for the server's
 * owner email and the Dashboard's plan picker, each with its own plan
 * comparison. Here, a comparison by plan order: API keys from Growth, SCIM
 * from Scale.
 */
describe("what a move between plans stops", () => {
  const ORDER: Array<PlanType> = [
    PlanType.Free,
    PlanType.Growth,
    PlanType.Scale,
    PlanType.Enterprise,
  ];

  const isOnPlan: (
    credential: PlanCutoffCredential,
    plan: PlanType,
  ) => boolean = (
    credential: PlanCutoffCredential,
    plan: PlanType,
  ): boolean => {
    const required: PlanType =
      credential === PlanCutoffCredential.ApiKey
        ? PlanType.Growth
        : PlanType.Scale;

    return ORDER.indexOf(plan) >= ORDER.indexOf(required);
  };

  test.each([
    [
      PlanType.Scale,
      PlanType.Free,
      [
        PlanCutoffCredential.ApiKey,
        PlanCutoffCredential.ProjectSCIM,
        PlanCutoffCredential.StatusPageSCIM,
      ],
    ],
    [
      PlanType.Scale,
      PlanType.Growth,
      [PlanCutoffCredential.ProjectSCIM, PlanCutoffCredential.StatusPageSCIM],
    ],
    [PlanType.Growth, PlanType.Free, [PlanCutoffCredential.ApiKey]],
    [
      PlanType.Enterprise,
      PlanType.Growth,
      [PlanCutoffCredential.ProjectSCIM, PlanCutoffCredential.StatusPageSCIM],
    ],
  ])(
    "%s to %s stops what worked on the first and not on the second",
    (
      fromPlan: PlanType,
      toPlan: PlanType,
      expected: Array<PlanCutoffCredential>,
    ) => {
      expect(
        getCredentialsStoppedByMove({ fromPlan, toPlan, isOnPlan }),
      ).toEqual(expected);
    },
  );

  test.each([
    [PlanType.Free, PlanType.Scale],
    [PlanType.Growth, PlanType.Scale],
    [PlanType.Free, PlanType.Growth],
    [PlanType.Scale, PlanType.Enterprise],
  ])(
    "%s to %s, an upgrade, stops nothing",
    (fromPlan: PlanType, toPlan: PlanType) => {
      expect(
        getCredentialsStoppedByMove({ fromPlan, toPlan, isOnPlan }),
      ).toEqual([]);
    },
  );

  test("a move within one plan (monthly to yearly) stops nothing", () => {
    expect(
      getCredentialsStoppedByMove({
        fromPlan: PlanType.Scale,
        toPlan: PlanType.Scale,
        isOnPlan,
      }),
    ).toEqual([]);
  });

  test("a move from a plan that is not known stops nothing: nothing is known to work on it", () => {
    expect(
      getCredentialsStoppedByMove({
        fromPlan: null,
        toPlan: PlanType.Free,
        isOnPlan,
      }),
    ).toEqual([]);
  });

  test("a move between two plans that both lack them stops nothing", () => {
    expect(
      getCredentialsStoppedByMove({
        fromPlan: PlanType.Growth,
        toPlan: PlanType.Free,
        isOnPlan: (): boolean => {
          return false;
        },
      }),
    ).toEqual([]);
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
