import UsagePricingSummary from "./UsagePricingSummary";
import IconProp from "Common/Types/Icon/IconProp";
import Card from "Common/UI/Components/Card/Card";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  isFreePlan: boolean;
  paymentMethodsCount: number | null;
  onAddPaymentMethod: () => void;
  onRetry: () => void;
}

const BillingUsageStatus: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const statusUnavailable: boolean = props.paymentMethodsCount === null;
  const hasPaymentMethod: boolean = (props.paymentMethodsCount || 0) > 0;

  const title: string = statusUnavailable
    ? "Payment method status unavailable"
    : hasPaymentMethod
      ? props.isFreePlan
        ? "Free plan + pay as you go"
        : "Pay as you go enabled"
      : props.isFreePlan
        ? "Free plan — paid usage locked"
        : "No payment method on file";

  return (
    <Card
      title={title}
      buttons={
        statusUnavailable
          ? [
              {
                title: "Retry payment method check",
                icon: IconProp.Refresh,
                onClick: props.onRetry,
              },
            ]
          : !hasPaymentMethod
            ? [
                {
                  title: props.isFreePlan
                    ? "Enable paid usage"
                    : "Add payment method",
                  icon: IconProp.Billing,
                  onClick: props.onAddPaymentMethod,
                  buttonStyle: ButtonStyleType.NORMAL,
                },
              ]
            : []
      }
    >
      <div className="space-y-4" data-testid="billing-usage-status">
        <p className="text-sm text-gray-700">
          {statusUnavailable
            ? "We could not check this project's payment methods. Retry to see whether paid usage is enabled."
            : hasPaymentMethod
              ? "A payment method is on file. Paid features are billed as you use them, separately from your subscription."
              : props.isFreePlan
                ? "No payment method is on file. Paid features require a payment method before they can create new usage charges. Your free features remain available."
                : "Add a payment method before using paid features, including during a trial. Projects with an active invoice billing agreement can continue under that agreement."}
        </p>
        <p className="text-sm text-gray-700">
          {props.isFreePlan
            ? "Your Free subscription is $0. Adding a payment method enables paid usage and keeps you on the Free plan. Upgrade your plan separately if you need additional subscription features."
            : "Adding a payment method does not change your subscription plan. Usage charges are separate from subscription charges."}
        </p>
        <UsagePricingSummary />
      </div>
    </Card>
  );
};

export default BillingUsageStatus;
