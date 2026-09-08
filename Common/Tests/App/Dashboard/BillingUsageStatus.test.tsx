import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it } from "@jest/globals";
import BillingUsageStatus from "../../../../App/FeatureSet/Dashboard/src/Components/Billing/BillingUsageStatus";
import {
  ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH,
  PRICING_PAGE_URL,
  SESSION_REPLAY_PRICE_IN_USD_PER_GB,
  TELEMETRY_PRICE_IN_USD_PER_GB,
  formatPriceInUSD,
} from "../../../Types/Billing/PayAsYouGoPricing";
import getJestMockFunction, { MockFunction } from "../../MockType";

function renderStatus(data: {
  paymentMethodsCount: number | null;
  isFreePlan?: boolean;
}): { onAddPaymentMethod: MockFunction; onRetry: MockFunction } {
  const onAddPaymentMethod: MockFunction = getJestMockFunction();
  const onRetry: MockFunction = getJestMockFunction();
  render(
    <BillingUsageStatus
      isFreePlan={data.isFreePlan ?? true}
      paymentMethodsCount={data.paymentMethodsCount}
      onAddPaymentMethod={onAddPaymentMethod}
      onRetry={onRetry}
    />,
  );
  return { onAddPaymentMethod, onRetry };
}

describe("Billing usage status", () => {
  it("explains that a Free project without a payment method cannot run paid features", async () => {
    const { onAddPaymentMethod } = renderStatus({ paymentMethodsCount: 0 });
    expect(
      screen.getByRole("heading", { name: "Free plan — paid usage locked" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Your free features remain available/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Your Free subscription is \$0/)).toHaveTextContent(
      "Upgrade your plan separately",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Enable paid usage" }),
    );
    expect(onAddPaymentMethod).toHaveBeenCalledTimes(1);
  });

  it.each([1, 2])(
    "labels Free plus paid usage when %i payment methods are present",
    (paymentMethodsCount: number) => {
      renderStatus({ paymentMethodsCount });
      expect(
        screen.getByRole("heading", { name: "Free plan + pay as you go" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          /Paid features are billed as you use them, separately from your subscription/,
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Enable paid usage" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText(/keeps you on the Free plan/),
      ).toBeInTheDocument();
    },
  );

  it("shows published rates, replay's separate price and a pricing link", () => {
    renderStatus({ paymentMethodsCount: 0 });
    expect(screen.getByText(/Active monitors:/)).toHaveTextContent(
      `${formatPriceInUSD(ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH)} per monitor per month`,
    );
    expect(screen.getByText(/Logs, traces, metrics/)).toHaveTextContent(
      `${formatPriceInUSD(TELEMETRY_PRICE_IN_USD_PER_GB)} per GB ingested`,
    );
    expect(screen.getByText(/Session replay:/)).toHaveTextContent(
      `${formatPriceInUSD(SESSION_REPLAY_PRICE_IN_USD_PER_GB)} per GB`,
    );
    expect(screen.getByRole("link", { name: "full pricing" })).toHaveAttribute(
      "href",
      PRICING_PAGE_URL,
    );
    expect(screen.getByRole("link", { name: "full pricing" })).toHaveAttribute(
      "target",
      "_blank",
    );
  });

  it("does not report payment lookup failure as zero payment methods", async () => {
    const { onRetry, onAddPaymentMethod } = renderStatus({
      paymentMethodsCount: null,
    });
    expect(
      screen.getByRole("heading", {
        name: "Payment method status unavailable",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Free plan — paid usage locked"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Free plan + pay as you go"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Enable paid usage" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Retry payment method check" }),
    );
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onAddPaymentMethod).not.toHaveBeenCalled();
  });

  it("does not claim a paid invoice contract without a card is locked", async () => {
    const { onAddPaymentMethod } = renderStatus({
      paymentMethodsCount: 0,
      isFreePlan: false,
    });
    expect(
      screen.getByRole("heading", { name: "No payment method on file" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/active invoice billing agreement can continue/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/paid usage locked/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Your Free subscription/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Enable paid usage" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Add payment method" }),
    );
    expect(onAddPaymentMethod).toHaveBeenCalledTimes(1);
  });

  it("distinguishes subscription charges from paid usage on paid plans", () => {
    renderStatus({ paymentMethodsCount: 1, isFreePlan: false });
    expect(
      screen.getByRole("heading", { name: "Pay as you go enabled" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Usage charges are separate from subscription charges/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Your Free subscription/),
    ).not.toBeInTheDocument();
  });

  it("updates from enabled to locked when the last payment method is removed", () => {
    const { rerender } = render(
      <BillingUsageStatus
        isFreePlan={true}
        paymentMethodsCount={1}
        onAddPaymentMethod={() => {}}
        onRetry={() => {}}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Free plan + pay as you go" }),
    ).toBeInTheDocument();
    rerender(
      <BillingUsageStatus
        isFreePlan={true}
        paymentMethodsCount={0}
        onAddPaymentMethod={() => {}}
        onRetry={() => {}}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Free plan — paid usage locked" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Enable paid usage" }),
    ).toBeInTheDocument();
  });
});
