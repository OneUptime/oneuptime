import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React, { FunctionComponent, ReactElement, useEffect } from "react";

/*
 * PlanGatedPage: what a page every edition includes, but OneUptime Cloud
 * sells on a plan (single sign-on), renders through.
 *
 * Only the plan counts, and only on the Cloud (billing on): the page, or the
 * plan upsell card with the Plan reason - never the Enterprise Edition one.
 * With billing off (every self-hosted install) the page always renders, and
 * the edition flag and the plan are never consulted. The check runs on every
 * render, and an ineligible project never mounts the page at all, so the
 * page's own requests and hooks never run for it.
 *
 * Billing, the edition and the plan are pinned in every test: CI's
 * config.env sets BILLING_ENABLED=true.
 */

let billingEnabledForTest: boolean = false;
let enterpriseEditionForTest: boolean = false;
let currentPlanForTest: string | null = null;
let currentPlanThrows: boolean = false;
let editionReads: number = 0;

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
      editionReads += 1;
      return enterpriseEditionForTest;
    },
  });

  mocked["getAllEnvVars"] = (): Record<string, string> => {
    return CLOUD_PLAN_ENV;
  };

  return mocked;
});

import PlanGatedPage, {
  PlanGatedPageUpsellProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Billing/PlanGatedPage";
import { SSO_REQUIRED_PLAN } from "../../../../App/FeatureSet/Dashboard/src/Enterprise/EnterpriseEligibility";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import IconProp from "../../../Types/Icon/IconProp";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";

const UPSELL: PlanGatedPageUpsellProps = {
  title: "Single Sign On (SSO)",
  description: "Configure SAML SSO for your project.",
  featureName: "SAML Single Sign On",
  featureDescription: "Let team members sign in with your IdP.",
  benefits: [
    {
      icon: IconProp.Lock,
      title: "Centralized auth",
      subtitle: "Revoke access from one place.",
    },
  ],
};

let pageMounts: number = 0;
let pageRenders: number = 0;

// A page with hooks and an effect, like the real ones (tables that load).
const FakePage: FunctionComponent = (): ReactElement => {
  const [label] = React.useState<string>("the page");

  pageRenders += 1;

  useEffect(() => {
    pageMounts += 1;
  }, []);

  return <div data-testid="gated-page">{label}</div>;
};

const renderGate: (
  requiredPlan?: PlanType.Scale | PlanType.Enterprise,
) => ReturnType<typeof render> = (
  requiredPlan: PlanType.Scale | PlanType.Enterprise = SSO_REQUIRED_PLAN,
): ReturnType<typeof render> => {
  return render(
    <PlanGatedPage requiredPlan={requiredPlan} upsell={UPSELL}>
      <FakePage />
    </PlanGatedPage>,
  );
};

const expectUpsell: (planName: string) => void = (planName: string): void => {
  expect(screen.getAllByText(`Upgrade to ${planName}`)).toHaveLength(2);
  expect(screen.getByText("SAML Single Sign On")).toBeInTheDocument();
  expect(screen.getByText("Single Sign On (SSO)")).toBeInTheDocument();
  expect(screen.getByText("Centralized auth")).toBeInTheDocument();
  expect(screen.getByText("Compare plans")).toBeInTheDocument();
  expect(
    screen.queryByText("Learn about Enterprise Edition"),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/Enterprise Edition/)).not.toBeInTheDocument();
  expect(screen.queryByTestId("gated-page")).not.toBeInTheDocument();
};

beforeEach(() => {
  billingEnabledForTest = false;
  enterpriseEditionForTest = false;
  currentPlanForTest = null;
  currentPlanThrows = false;
  editionReads = 0;
  pageMounts = 0;
  pageRenders = 0;

  getJestSpyOn(ProjectUtil, "getCurrentPlan").mockImplementation(
    (): string | null => {
      if (currentPlanThrows) {
        throw new Error("Plan ID is invalid");
      }

      return currentPlanForTest;
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("PlanGatedPage when self-hosted (billing off)", () => {
  test.each([
    ["the Community Edition", false],
    ["the Enterprise Edition", true],
  ])(
    "renders the page on %s, without reading the edition or the plan",
    (_edition: string, isEnterprise: boolean) => {
      enterpriseEditionForTest = isEnterprise;
      // A plan read would throw: it must not happen.
      currentPlanThrows = true;

      renderGate();

      expect(screen.getByTestId("gated-page")).toHaveTextContent("the page");
      expect(pageMounts).toBe(1);
      expect(screen.queryByText("SAML Single Sign On")).not.toBeInTheDocument();
      expect(editionReads).toBe(0);
      expect(ProjectUtil.getCurrentPlan).not.toHaveBeenCalled();
    },
  );

  test("renders the page for an Enterprise-plan feature too: no plan applies off the Cloud", () => {
    renderGate(PlanType.Enterprise);

    expect(screen.getByTestId("gated-page")).toBeInTheDocument();
  });
});

describe("PlanGatedPage on OneUptime Cloud (billing on)", () => {
  beforeEach(() => {
    billingEnabledForTest = true;
    // The Cloud runs the Enterprise image; the edition must not unlock anything.
    enterpriseEditionForTest = true;
  });

  test.each([PlanType.Free, PlanType.Growth])(
    "a project on the %s plan sees the Scale plan upsell and never mounts the page",
    (plan: PlanType) => {
      currentPlanForTest = plan;

      renderGate();

      expectUpsell("Scale");
      expect(pageMounts).toBe(0);
      expect(pageRenders).toBe(0);
      expect(
        screen.getByText(
          "SAML Single Sign On is available on the Scale plan and above. Upgrade to enable it for this project.",
        ),
      ).toBeInTheDocument();
    },
  );

  test.each([PlanType.Scale, PlanType.Enterprise])(
    "a project on the %s plan gets the page",
    (plan: PlanType) => {
      currentPlanForTest = plan;

      renderGate();

      expect(screen.getByTestId("gated-page")).toBeInTheDocument();
      expect(screen.queryByText("Upgrade to Scale")).not.toBeInTheDocument();
    },
  );

  test("no plan, or one the Dashboard cannot read, fails closed", () => {
    currentPlanForTest = null;

    const { unmount } = renderGate();

    expectUpsell("Scale");
    unmount();

    currentPlanThrows = true;

    renderGate();

    expectUpsell("Scale");
  });

  test("uses the page's own plan: Scale is not enough for an Enterprise-plan page", () => {
    currentPlanForTest = PlanType.Scale;

    renderGate(PlanType.Enterprise);

    expectUpsell("Enterprise");
    expect(
      screen.getByText(
        "SAML Single Sign On is available on the Enterprise plan. Upgrade to enable it for this project.",
      ),
    ).toBeInTheDocument();
  });

  test("never falls back to the edition flag", () => {
    currentPlanForTest = PlanType.Free;

    renderGate();

    expectUpsell("Scale");
    expect(editionReads).toBe(0);
  });

  test("checks the plan on every render: the page comes and goes with it, hooks intact", () => {
    currentPlanForTest = null;

    const { rerender } = renderGate();

    expectUpsell("Scale");

    const renderAgain: () => void = (): void => {
      rerender(
        <PlanGatedPage requiredPlan={SSO_REQUIRED_PLAN} upsell={UPSELL}>
          <FakePage />
        </PlanGatedPage>,
      );
    };

    currentPlanForTest = PlanType.Scale;
    renderAgain();

    expect(screen.getByTestId("gated-page")).toBeInTheDocument();
    expect(pageMounts).toBe(1);

    currentPlanForTest = PlanType.Growth;
    renderAgain();

    expectUpsell("Scale");

    currentPlanForTest = PlanType.Enterprise;
    renderAgain();

    expect(screen.getByTestId("gated-page")).toBeInTheDocument();
    expect(pageMounts).toBe(2);
  });
});

/*
 * A paid feature can always be switched off, on any plan: below the plan,
 * what the page can still switch off is drawn under the upsell (belowPlan),
 * and never on a plan that has the feature, where the page itself is shown.
 */
describe("PlanGatedPage draws what can still be switched off under the upsell", () => {
  const BelowPlan: FunctionComponent = (): ReactElement => {
    return <div data-testid="below-plan">Require SSO for Login</div>;
  };

  const renderWithBelowPlan: () => ReturnType<typeof render> = (): ReturnType<
    typeof render
  > => {
    return render(
      <PlanGatedPage
        requiredPlan={SSO_REQUIRED_PLAN}
        upsell={UPSELL}
        belowPlan={<BelowPlan />}
      >
        <FakePage />
      </PlanGatedPage>,
    );
  };

  test.each([PlanType.Free, PlanType.Growth])(
    "on OneUptime Cloud, a project on the %s plan sees the upsell, then the switches under it",
    (plan: PlanType) => {
      billingEnabledForTest = true;
      currentPlanForTest = plan;

      renderWithBelowPlan();

      expectUpsell("Scale");

      const belowPlan: HTMLElement = screen.getByTestId("below-plan");
      const upsellTitle: HTMLElement = screen.getByText("SAML Single Sign On");

      // Under the upsell, not in place of it.
      expect(
        Boolean(
          upsellTitle.compareDocumentPosition(belowPlan) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      ).toBe(true);
      expect(pageMounts).toBe(0);
    },
  );

  test.each([PlanType.Scale, PlanType.Enterprise])(
    "on the %s plan only the page shows: its own switches are on it",
    (plan: PlanType) => {
      billingEnabledForTest = true;
      currentPlanForTest = plan;

      renderWithBelowPlan();

      expect(screen.getByTestId("gated-page")).toBeInTheDocument();
      expect(screen.queryByTestId("below-plan")).not.toBeInTheDocument();
    },
  );

  test("self-hosted (billing off), only the page shows", () => {
    billingEnabledForTest = false;

    renderWithBelowPlan();

    expect(screen.getByTestId("gated-page")).toBeInTheDocument();
    expect(screen.queryByTestId("below-plan")).not.toBeInTheDocument();
  });

  test("without belowPlan, the upsell is the whole page, as before", () => {
    billingEnabledForTest = true;
    currentPlanForTest = PlanType.Free;

    renderGate();

    expectUpsell("Scale");
    expect(screen.queryByTestId("below-plan")).not.toBeInTheDocument();
  });
});
