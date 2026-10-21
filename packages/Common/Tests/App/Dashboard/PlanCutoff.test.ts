import { describe, expect, jest, test } from "@jest/globals";

/*
 * What a project's plan does to its API keys and SCIM connections, as the
 * Billing page shows it (Dashboard Components/Billing/PlanCutoff): how many
 * a move to a lower plan stops, how many the project's plan has stopped,
 * and the sentences that say so. API keys need Growth and SCIM needs Scale,
 * the plans the server holds them to (Common/Types/Billing/
 * PlanCutoffCredentials, PlanCutoffCredentialAccess).
 */

const CLOUD_PLAN_ENV: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,priceMonthlyId1,priceYearlyId1,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH: "Growth,priceMonthlyId2,priceYearlyId2,0,0,2,14",
  SUBSCRIPTION_PLAN_SCALE: "Scale,priceMonthlyId3,priceYearlyId3,0,0,3,0",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,priceMonthlyId4,priceYearlyId4,-1,-1,4,14",
};

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  return {
    ...actual,
    getAllEnvVars: (): Record<string, string> => {
      return CLOUD_PLAN_ENV;
    },
  };
});

import {
  API_KEY_REQUIRED_PLAN,
  getStopSentences,
  getStoppedByMove,
  getStoppedOnPlan,
  getStoppedSentences,
  hasPlanCutoff,
  NO_PLAN_CUTOFF_COUNTS,
  PlanCutoffCopy,
  PlanCutoffCounts,
  SCIM_REQUIRED_PLAN,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Billing/PlanCutoff";
import ApiKey from "../../../Models/DatabaseModels/ApiKey";
import ProjectSCIM from "../../../Models/DatabaseModels/ProjectSCIM";
import StatusPageSCIM from "../../../Models/DatabaseModels/StatusPageSCIM";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";

const english: Translator = createTranslator(undefined);

const THREE_KEYS_TWO_SCIM: PlanCutoffCounts = {
  apiKeys: 3,
  scimConnections: 2,
};

describe("the plans the Billing page names", () => {
  test("API keys need Growth, the plan the server holds them to", () => {
    expect(API_KEY_REQUIRED_PLAN).toBe(PlanType.Growth);
    expect(new ApiKey().getCreateBillingPlan()).toBe(API_KEY_REQUIRED_PLAN);
  });

  test("SCIM needs Scale, for project and status page connections alike", () => {
    expect(SCIM_REQUIRED_PLAN).toBe(PlanType.Scale);
    expect(new ProjectSCIM().getCreateBillingPlan()).toBe(SCIM_REQUIRED_PLAN);
    expect(new StatusPageSCIM().getCreateBillingPlan()).toBe(
      SCIM_REQUIRED_PLAN,
    );
  });
});

describe("what a plan has stopped", () => {
  test.each([
    [PlanType.Free, { apiKeys: 3, scimConnections: 2 }],
    [PlanType.Growth, { apiKeys: 0, scimConnections: 2 }],
    [PlanType.Scale, { apiKeys: 0, scimConnections: 0 }],
    [PlanType.Enterprise, { apiKeys: 0, scimConnections: 0 }],
  ])("on %s: %j", (plan: PlanType, expected: PlanCutoffCounts) => {
    expect(
      getStoppedOnPlan({ counts: THREE_KEYS_TWO_SCIM, plan: plan }),
    ).toEqual(expected);
  });

  test("on a plan that is not known: nothing", () => {
    expect(
      getStoppedOnPlan({ counts: THREE_KEYS_TWO_SCIM, plan: null }),
    ).toEqual(NO_PLAN_CUTOFF_COUNTS);
  });
});

describe("what a move stops", () => {
  test.each([
    [PlanType.Enterprise, PlanType.Free, { apiKeys: 3, scimConnections: 2 }],
    [PlanType.Scale, PlanType.Free, { apiKeys: 3, scimConnections: 2 }],
    [PlanType.Scale, PlanType.Growth, { apiKeys: 0, scimConnections: 2 }],
    [PlanType.Growth, PlanType.Free, { apiKeys: 3, scimConnections: 0 }],
    [PlanType.Enterprise, PlanType.Scale, { apiKeys: 0, scimConnections: 0 }],
    [PlanType.Free, PlanType.Growth, { apiKeys: 0, scimConnections: 0 }],
    [PlanType.Free, PlanType.Enterprise, { apiKeys: 0, scimConnections: 0 }],
    [PlanType.Growth, PlanType.Scale, { apiKeys: 0, scimConnections: 0 }],
    [PlanType.Growth, PlanType.Growth, { apiKeys: 0, scimConnections: 0 }],
  ])(
    "%s to %s stops %j",
    (from: PlanType, to: PlanType, expected: PlanCutoffCounts) => {
      expect(
        getStoppedByMove({
          counts: THREE_KEYS_TWO_SCIM,
          fromPlan: from,
          toPlan: to,
        }),
      ).toEqual(expected);
    },
  );

  test("from a plan that is not known: nothing, since nothing is known to work", () => {
    expect(
      getStoppedByMove({
        counts: THREE_KEYS_TWO_SCIM,
        fromPlan: null,
        toPlan: PlanType.Free,
      }),
    ).toEqual(NO_PLAN_CUTOFF_COUNTS);
  });

  test("a project with none to stop: nothing", () => {
    expect(
      getStoppedByMove({
        counts: NO_PLAN_CUTOFF_COUNTS,
        fromPlan: PlanType.Scale,
        toPlan: PlanType.Free,
      }),
    ).toEqual(NO_PLAN_CUTOFF_COUNTS);
  });

  test("hasPlanCutoff is whether anything is known to stop", () => {
    expect(hasPlanCutoff(NO_PLAN_CUTOFF_COUNTS)).toBe(false);
    expect(hasPlanCutoff({ apiKeys: 1, scimConnections: 0 })).toBe(true);
    expect(hasPlanCutoff({ apiKeys: 0, scimConnections: 1 })).toBe(true);
    expect(hasPlanCutoff({ apiKeys: null, scimConnections: null })).toBe(false);
  });

  /*
   * Someone who may change the plan need not be able to read the project's
   * API keys or SCIM connections: a count they may not read is not known,
   * and a move that stops that kind says so without a number.
   */
  test("a count that is not known stays not known where the move stops it, and none where it does not", () => {
    const notKnown: PlanCutoffCounts = { apiKeys: null, scimConnections: null };

    expect(
      getStoppedByMove({
        counts: notKnown,
        fromPlan: PlanType.Scale,
        toPlan: PlanType.Free,
      }),
    ).toEqual({ apiKeys: null, scimConnections: null });
    expect(
      getStoppedByMove({
        counts: notKnown,
        fromPlan: PlanType.Scale,
        toPlan: PlanType.Growth,
      }),
    ).toEqual({ apiKeys: 0, scimConnections: null });
    expect(
      getStoppedByMove({
        counts: notKnown,
        fromPlan: PlanType.Free,
        toPlan: PlanType.Scale,
      }),
    ).toEqual(NO_PLAN_CUTOFF_COUNTS);
    expect(
      getStoppedOnPlan({ counts: notKnown, plan: PlanType.Growth }),
    ).toEqual({ apiKeys: 0, scimConnections: null });
  });
});

describe("the sentences in the plan picker", () => {
  test("name how many API keys and SCIM connections the plan stops", () => {
    expect(
      getStopSentences({
        translator: english,
        stopped: { apiKeys: 3, scimConnections: 2 },
      }),
    ).toEqual([
      "Your 3 API keys stop working on this plan.",
      "Your 2 SCIM connections only remove people on this plan.",
    ]);
  });

  test("speak of one key and one connection in the singular", () => {
    expect(
      getStopSentences({
        translator: english,
        stopped: { apiKeys: 1, scimConnections: 1 },
      }),
    ).toEqual([
      "Your API key stops working on this plan.",
      "Your SCIM connection only removes people on this plan.",
    ]);
  });

  test("say that they stop, without a number, when how many is not known", () => {
    expect(
      getStopSentences({
        translator: english,
        stopped: { apiKeys: null, scimConnections: null },
      }),
    ).toEqual([
      "API keys stop working on this plan.",
      "SCIM connections only remove people on this plan.",
    ]);
    expect(
      getStopSentences({
        translator: english,
        stopped: { apiKeys: 2, scimConnections: null },
      }),
    ).toEqual([
      "Your 2 API keys stop working on this plan.",
      "SCIM connections only remove people on this plan.",
    ]);
  });

  test("say nothing about what does not stop", () => {
    expect(
      getStopSentences({
        translator: english,
        stopped: { apiKeys: 0, scimConnections: 4 },
      }),
    ).toEqual(["Your 4 SCIM connections only remove people on this plan."]);
    expect(
      getStopSentences({ translator: english, stopped: NO_PLAN_CUTOFF_COUNTS }),
    ).toEqual([]);
  });
});

describe("the sentences about the plan the project is on", () => {
  test("name how many stopped and the plan that turns each back on", () => {
    expect(
      getStoppedSentences({
        translator: english,
        stopped: { apiKeys: 3, scimConnections: 2 },
      }),
    ).toEqual([
      "Your 3 API keys stopped working on this plan. They work again on the Growth plan.",
      "Your 2 SCIM connections only remove people on this plan: your identity provider can no longer add or change people. They work fully again on the Scale plan.",
    ]);
  });

  test("speak of one in the singular", () => {
    expect(
      getStoppedSentences({
        translator: english,
        stopped: { apiKeys: 1, scimConnections: 1 },
      }),
    ).toEqual([
      "Your API key stopped working on this plan. It works again on the Growth plan.",
      "Your SCIM connection only removes people on this plan: your identity provider can no longer add or change people. It works fully again on the Scale plan.",
    ]);
  });

  test("say nothing about a kind whose count is not known", () => {
    expect(
      getStoppedSentences({
        translator: english,
        stopped: { apiKeys: null, scimConnections: 2 },
      }),
    ).toEqual([
      "Your 2 SCIM connections only remove people on this plan: your identity provider can no longer add or change people. They work fully again on the Scale plan.",
    ]);
  });

  test("say nothing when nothing stopped", () => {
    expect(
      getStoppedSentences({
        translator: english,
        stopped: NO_PLAN_CUTOFF_COUNTS,
      }),
    ).toEqual([]);
  });

  test("the note above them has a title", () => {
    expect(PlanCutoffCopy.stoppedNoteTitle).toBe("Not included in this plan");
  });
});
