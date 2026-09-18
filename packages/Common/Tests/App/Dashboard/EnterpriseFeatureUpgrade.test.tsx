import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Who sees an enterprise feature and who sees its upsell - one tier-aware
 * rule, shared by the enterprise card and the audit log card.
 *
 * OneUptime Cloud (billing on) compares the project's plan with the tier the
 * feature's model is sold at: Scale for SSO / OIDC / SCIM / team compliance,
 * Enterprise for audit logs. The Cloud runs the Enterprise image, so the
 * edition flag is always true there and must not be consulted. Self-hosted
 * (billing off) asks only whether this is the Enterprise Edition.
 *
 * Before this, both cards demanded the Enterprise plan: a Scale customer was
 * walled off from SSO their plan includes. And the edition flag was checked
 * first, which on an Enterprise-image Cloud would unlock everything for
 * every plan.
 *
 * Both billing and the edition are pinned in every test: CI's config.env sets
 * BILLING_ENABLED=true, so anything left to the environment tests the Cloud
 * path only.
 */

let billingEnabledForTest: boolean = false;
let enterpriseEditionForTest: boolean = false;
let currentPlanForTest: string | null = null;
let currentPlanThrows: boolean = false;
let planEnvForTest: Record<string, string> = {};

// jsdom does not implement window.open; the call to action uses it.
const openMock: MockFunction = getJestMockFunction();
const originalOpen: typeof window.open = window.open;

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

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabledForTest;
    },
  });

  Object.defineProperty(mocked, "IS_ENTERPRISE_EDITION", {
    get: (): boolean => {
      return enterpriseEditionForTest;
    },
  });

  mocked["getAllEnvVars"] = (): Record<string, string> => {
    return planEnvForTest;
  };

  return mocked;
});

jest.mock("../../../UI/Utils/Project", () => {
  const actual: Record<string, any> = jest.requireActual(
    "../../../UI/Utils/Project",
  ) as Record<string, any>;

  return {
    __esModule: true,
    ...actual,
    default: {
      ...actual["default"],
      getCurrentPlan: (): string | null => {
        if (currentPlanThrows) {
          throw new Error("Plan ID is invalid");
        }

        return currentPlanForTest;
      },
    },
  };
});

import EnterpriseFeatureUpgrade, {
  EnterpriseUpgradeCopy,
  EnterpriseUpgradeReason,
  getDefaultUpgradeReason,
  getEnterpriseUpgradeCopy,
  isEnterpriseFeatureEligible as isEnterpriseFeatureEligibleFromCard,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EnterpriseEdition/EnterpriseFeatureUpgrade";
import AuditLogsEnterpriseUpgrade, {
  isAuditLogsEnterpriseEligible,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AuditLogs/AuditLogsEnterpriseUpgrade";
import {
  AUDIT_LOGS_REQUIRED_PLAN,
  IDENTITY_REQUIRED_PLAN,
  getCurrentPlanOrNull,
  isEnterpriseFeatureEligible,
  isPlanAtLeast,
} from "../../../../App/FeatureSet/Dashboard/src/Enterprise/EnterpriseEligibility";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import IconProp from "../../../Types/Icon/IconProp";

type Deployment = "cloud" | "self-hosted-enterprise" | "self-hosted-community";

const pinDeployment: (deployment: Deployment) => void = (
  deployment: Deployment,
): void => {
  billingEnabledForTest = deployment === "cloud";
  /*
   * The Cloud runs the Enterprise image, so its effective edition is true;
   * pinning it true proves the plan check does not fall back to it.
   */
  enterpriseEditionForTest = deployment !== "self-hosted-community";
};

beforeEach(() => {
  billingEnabledForTest = false;
  enterpriseEditionForTest = false;
  currentPlanForTest = null;
  currentPlanThrows = false;
  planEnvForTest = CLOUD_PLAN_ENV;
  openMock.mockReset();
  window.open = openMock as unknown as typeof window.open;
});

afterEach(() => {
  cleanup();
  window.open = originalOpen;
});

describe("which plan each enterprise feature needs", () => {
  test("SSO, OIDC, SCIM and compliance are Scale; audit logs are Enterprise", () => {
    expect(IDENTITY_REQUIRED_PLAN).toBe(PlanType.Scale);
    expect(AUDIT_LOGS_REQUIRED_PLAN).toBe(PlanType.Enterprise);
  });
});

describe("isPlanAtLeast", () => {
  test.each([
    [PlanType.Scale, PlanType.Free, false],
    [PlanType.Scale, PlanType.Growth, false],
    [PlanType.Scale, PlanType.Scale, true],
    [PlanType.Scale, PlanType.Enterprise, true],
    [PlanType.Enterprise, PlanType.Growth, false],
    [PlanType.Enterprise, PlanType.Scale, false],
    [PlanType.Enterprise, PlanType.Enterprise, true],
  ])(
    "needs %s, has %s -> %s",
    (required: PlanType, current: PlanType, expected: boolean) => {
      expect(isPlanAtLeast(required, current)).toBe(expected);
    },
  );

  test("no plan is never enough", () => {
    expect(isPlanAtLeast(PlanType.Scale, null)).toBe(false);
  });

  test("plans that cannot be ordered count as not enough, except an exact match", () => {
    /*
     * With no SUBSCRIPTION_PLAN_* the order is unknown. The upsell check
     * must not throw its way into an error boundary.
     */
    planEnvForTest = {};

    expect(isPlanAtLeast(PlanType.Scale, PlanType.Enterprise)).toBe(false);
    expect(isPlanAtLeast(PlanType.Scale, PlanType.Scale)).toBe(true);
  });
});

describe("getCurrentPlanOrNull", () => {
  test("passes the project's plan through", () => {
    currentPlanForTest = PlanType.Growth;
    expect(getCurrentPlanOrNull()).toBe(PlanType.Growth);
  });

  test("turns an unknown plan id into no plan instead of throwing", () => {
    currentPlanThrows = true;
    expect(getCurrentPlanOrNull()).toBeNull();
  });
});

describe("isEnterpriseFeatureEligible on OneUptime Cloud", () => {
  beforeEach(() => {
    pinDeployment("cloud");
  });

  test.each([
    [PlanType.Free, false],
    [PlanType.Growth, false],
    [PlanType.Scale, true],
    [PlanType.Enterprise, true],
  ])(
    "a %s project gets the Scale-tier features: %s",
    (plan: PlanType, expected: boolean) => {
      currentPlanForTest = plan;

      expect(isEnterpriseFeatureEligible(PlanType.Scale)).toBe(expected);
    },
  );

  test.each([
    [PlanType.Growth, false],
    [PlanType.Scale, false],
    [PlanType.Enterprise, true],
  ])(
    "a %s project gets the Enterprise-tier features: %s",
    (plan: PlanType, expected: boolean) => {
      currentPlanForTest = plan;

      expect(isEnterpriseFeatureEligible(PlanType.Enterprise)).toBe(expected);
    },
  );

  test("defaults to the Scale tier, so existing callers fix the Scale-plan wall", () => {
    currentPlanForTest = PlanType.Scale;
    expect(isEnterpriseFeatureEligible()).toBe(true);

    currentPlanForTest = PlanType.Growth;
    expect(isEnterpriseFeatureEligible()).toBe(false);
  });

  test("never falls back to the edition flag - the Cloud runs the Enterprise image", () => {
    enterpriseEditionForTest = true;
    currentPlanForTest = PlanType.Free;

    expect(isEnterpriseFeatureEligible(PlanType.Scale)).toBe(false);
    expect(isEnterpriseFeatureEligible(PlanType.Enterprise)).toBe(false);
  });

  test("a project with no plan, or an unknown one, gets the upsell", () => {
    currentPlanForTest = null;
    expect(isEnterpriseFeatureEligible(PlanType.Scale)).toBe(false);

    currentPlanThrows = true;
    expect(isEnterpriseFeatureEligible(PlanType.Scale)).toBe(false);
  });

  test("the card re-exports the same check under its old name", () => {
    expect(isEnterpriseFeatureEligibleFromCard).toBe(
      isEnterpriseFeatureEligible,
    );
  });
});

describe("isEnterpriseFeatureEligible when self-hosted", () => {
  test("the Enterprise Edition gets every feature, whatever the plan says", () => {
    pinDeployment("self-hosted-enterprise");
    currentPlanForTest = PlanType.Free;

    expect(isEnterpriseFeatureEligible(PlanType.Scale)).toBe(true);
    expect(isEnterpriseFeatureEligible(PlanType.Enterprise)).toBe(true);
    expect(isEnterpriseFeatureEligible()).toBe(true);
  });

  test("the Community Edition gets none", () => {
    pinDeployment("self-hosted-community");
    currentPlanForTest = PlanType.Enterprise;

    expect(isEnterpriseFeatureEligible(PlanType.Scale)).toBe(false);
    expect(isEnterpriseFeatureEligible(PlanType.Enterprise)).toBe(false);
  });

  test("does not even ask for the plan", () => {
    pinDeployment("self-hosted-enterprise");
    currentPlanThrows = true;

    expect(isEnterpriseFeatureEligible(PlanType.Enterprise)).toBe(true);
  });
});

describe("isAuditLogsEnterpriseEligible", () => {
  test("needs the Enterprise plan on the Cloud - Scale is not enough", () => {
    pinDeployment("cloud");

    currentPlanForTest = PlanType.Scale;
    expect(isAuditLogsEnterpriseEligible()).toBe(false);

    currentPlanForTest = PlanType.Enterprise;
    expect(isAuditLogsEnterpriseEligible()).toBe(true);
  });

  test("follows the edition when self-hosted", () => {
    pinDeployment("self-hosted-enterprise");
    expect(isAuditLogsEnterpriseEligible()).toBe(true);

    pinDeployment("self-hosted-community");
    expect(isAuditLogsEnterpriseEligible()).toBe(false);
  });
});

describe("the upsell wording (getEnterpriseUpgradeCopy)", () => {
  test("sells the Scale plan, and says the plans above include it", () => {
    const copy: EnterpriseUpgradeCopy = getEnterpriseUpgradeCopy({
      featureName: "SAML Single Sign On",
      requiredPlan: PlanType.Scale,
      reason: EnterpriseUpgradeReason.Plan,
    });

    expect(copy.ctaTitle).toBe("Upgrade to Scale");
    expect(copy.badge).toBe(PlanType.Scale);
    expect(copy.pitchLine).toBe(
      "SAML Single Sign On is available on the Scale plan and above. Upgrade to enable it for this project.",
    );
    expect(copy.ctaUrl).toBe("https://oneuptime.com/pricing");
    expect(copy.secondaryTitle).toBe("Compare plans");
  });

  test("sells the Enterprise plan as the top plan", () => {
    const copy: EnterpriseUpgradeCopy = getEnterpriseUpgradeCopy({
      featureName: "Team Compliance Rules",
      requiredPlan: PlanType.Enterprise,
      reason: EnterpriseUpgradeReason.Plan,
    });

    expect(copy.ctaTitle).toBe("Upgrade to Enterprise");
    expect(copy.pitchLine).toBe(
      "Team Compliance Rules is available on the Enterprise plan. Upgrade to enable it for this project.",
    );
  });

  test("points at the Enterprise Edition when the plan is not the problem", () => {
    const copy: EnterpriseUpgradeCopy = getEnterpriseUpgradeCopy({
      featureName: "OIDC",
      requiredPlan: PlanType.Scale,
      reason: EnterpriseUpgradeReason.Edition,
    });

    expect(copy.ctaTitle).toBe("Learn about Enterprise Edition");
    expect(copy.badge).toBe("Enterprise");
    expect(copy.ctaUrl).toBe("https://oneuptime.com/enterprise/overview");
    expect(copy.secondaryTitle).toBe("Read docs");
    expect(copy.secondaryUrl).toBe(
      "https://oneuptime.com/docs/self-hosted/enterprise",
    );
    expect(copy.pitchLine).toBe(
      "OIDC is a OneUptime Enterprise Edition feature. Switch to the Enterprise Edition build to enable it.",
    );
    // Never a plan upgrade.
    expect(copy.pitchLine).not.toContain("plan");
  });

  test("uses a caller's own sentence for each reason", () => {
    expect(
      getEnterpriseUpgradeCopy({
        featureName: "Audit Logs",
        requiredPlan: PlanType.Enterprise,
        reason: EnterpriseUpgradeReason.Plan,
        planPitchLine: "Plan sentence.",
        editionPitchLine: "Edition sentence.",
      }).pitchLine,
    ).toBe("Plan sentence.");

    expect(
      getEnterpriseUpgradeCopy({
        featureName: "Audit Logs",
        requiredPlan: PlanType.Enterprise,
        reason: EnterpriseUpgradeReason.Edition,
        planPitchLine: "Plan sentence.",
        editionPitchLine: "Edition sentence.",
      }).pitchLine,
    ).toBe("Edition sentence.");
  });

  test("defaults the reason from billing", () => {
    pinDeployment("cloud");
    expect(getDefaultUpgradeReason()).toBe(EnterpriseUpgradeReason.Plan);

    pinDeployment("self-hosted-community");
    expect(getDefaultUpgradeReason()).toBe(EnterpriseUpgradeReason.Edition);
  });
});

describe("EnterpriseFeatureUpgrade", () => {
  const renderCard: (
    extra?: Partial<React.ComponentProps<typeof EnterpriseFeatureUpgrade>>,
  ) => void = (
    extra?: Partial<React.ComponentProps<typeof EnterpriseFeatureUpgrade>>,
  ): void => {
    render(
      <EnterpriseFeatureUpgrade
        title="Single Sign On (SSO)"
        description="Configure SAML SSO for your project."
        featureName="SAML Single Sign On"
        featureDescription="Let team members sign in with your IdP."
        benefits={[
          {
            icon: IconProp.Lock,
            title: "Centralized auth",
            subtitle: "Revoke access from one place.",
          },
        ]}
        {...(extra || {})}
      />,
    );
  };

  test("on the Cloud, sells the Scale plan by default and opens pricing", () => {
    pinDeployment("cloud");

    renderCard();

    expect(screen.getByText("Single Sign On (SSO)")).toBeInTheDocument();
    expect(screen.getByText("SAML Single Sign On")).toBeInTheDocument();
    expect(
      screen.getByText("Let team members sign in with your IdP."),
    ).toBeInTheDocument();
    expect(screen.getByText("Centralized auth")).toBeInTheDocument();
    expect(
      screen.getByText(
        "SAML Single Sign On is available on the Scale plan and above. Upgrade to enable it for this project.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Compare plans")).toBeInTheDocument();
    expect(screen.queryByText("Read docs")).not.toBeInTheDocument();

    // The header button and the body button carry the same call to action.
    const ctas: Array<HTMLElement> = screen.getAllByText("Upgrade to Scale");
    expect(ctas).toHaveLength(2);

    fireEvent.click(ctas[0]!);
    expect(openMock).toHaveBeenCalledWith(
      "https://oneuptime.com/pricing",
      "_blank",
    );
  });

  test("on the Cloud, an Enterprise-tier feature sells Enterprise", () => {
    pinDeployment("cloud");

    renderCard({ requiredPlan: PlanType.Enterprise });

    expect(screen.getAllByText("Upgrade to Enterprise")).toHaveLength(2);
    expect(
      screen.getByText(
        "SAML Single Sign On is available on the Enterprise plan. Upgrade to enable it for this project.",
      ),
    ).toBeInTheDocument();
  });

  test("self-hosted, points at the Enterprise Edition and its docs", () => {
    pinDeployment("self-hosted-community");

    renderCard();

    expect(
      screen.getAllByText("Learn about Enterprise Edition"),
    ).toHaveLength(2);
    expect(screen.queryByText("Compare plans")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Read docs"));
    expect(openMock).toHaveBeenCalledWith(
      "https://oneuptime.com/docs/self-hosted/enterprise",
      "_blank",
    );
  });

  test("an explicit Edition reason wins over billing", () => {
    pinDeployment("cloud");

    renderCard({ reason: EnterpriseUpgradeReason.Edition });

    expect(
      screen.getAllByText("Learn about Enterprise Edition"),
    ).toHaveLength(2);
    expect(screen.queryByText("Upgrade to Scale")).not.toBeInTheDocument();
  });
});

describe("AuditLogsEnterpriseUpgrade", () => {
  test("on the Cloud, sells the Enterprise plan with the audit log wording", () => {
    pinDeployment("cloud");

    render(
      <AuditLogsEnterpriseUpgrade
        title="Audit Logs"
        description="Every change made in this project."
      />,
    );

    expect(
      screen.getByText(
        "Audit Logs are available on the Enterprise plan. Upgrade to turn on audit logging for this project.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Upgrade to Enterprise")).toHaveLength(2);
    // The default feature description and the audit log benefits.
    expect(
      screen.getByText(
        "Record every create, update and delete performed on this project's resources.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Track every change")).toBeInTheDocument();
    expect(screen.getByText("Configurable retention")).toBeInTheDocument();
  });

  test("self-hosted, points at the Enterprise Edition", () => {
    pinDeployment("self-hosted-community");

    render(
      <AuditLogsEnterpriseUpgrade
        title="Audit Logs"
        description="Every change made in this project."
        featureDescription="A custom description."
      />,
    );

    expect(
      screen.getByText(
        "Audit Logs are a OneUptime Enterprise Edition feature. Switch to the Enterprise Edition build to enable audit logging.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("A custom description.")).toBeInTheDocument();
  });

  test("passes an explicit reason through", () => {
    pinDeployment("cloud");

    render(
      <AuditLogsEnterpriseUpgrade
        title="Audit Logs"
        description="Every change made in this project."
        reason={EnterpriseUpgradeReason.Edition}
      />,
    );

    expect(
      screen.getAllByText("Learn about Enterprise Edition"),
    ).toHaveLength(2);
    expect(screen.queryByText("Upgrade to Enterprise")).not.toBeInTheDocument();
  });
});
