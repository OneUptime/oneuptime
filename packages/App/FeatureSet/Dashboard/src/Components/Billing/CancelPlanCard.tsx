import SubscriptionPlan from "Common/Types/Billing/SubscriptionPlan";
import {
  BillingPeriod,
  isPlanFree,
} from "Common/Types/Billing/SubscriptionPlanPricing";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Navigation from "Common/UI/Utils/Navigation";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * The Billing page's Cancel Plan card, for a project OneUptime bills itself
 * (a reseller or a cloud marketplace cancels its own).
 *
 * It used to say "If you would like to cancel the plan, you need to delete
 * the project." beside a red Delete Project button that opened the Danger
 * Zone, so somebody who only wanted to stop paying for seats was walked
 * towards losing every monitor, incident and status page they had (#9129).
 * The plan can go down to Free instead, which keeps everything, and that is
 * what the card offers now: Switch to Free Plan asks once, saying what stops,
 * and moves the project there. It says what Free still bills, since usage
 * is paid as you go on every plan, and who to write to. Deleting the project
 * stays where it belongs, at the end of the Danger Zone.
 */

export const SUPPORT_EMAIL: string = "support@oneuptime.com";

export const CancelPlanCopy: {
  readonly title: string;
  readonly switchDescription: string;
  readonly onFreeDescription: string;
  readonly noFreePlanDescription: string;
  readonly nothingDeleted: string;
  readonly usageStillBilled: string;
  readonly askSupport: string;
  readonly switchButton: string;
  readonly contactSupportButton: string;
  readonly confirmTitle: string;
  readonly confirmDescription: string;
  readonly switched: string;
} = {
  title: translationKey("Cancel Plan"),
  switchDescription: translationKey(
    "Switch to the Free plan to stop paying for seats. Your monitors, incidents, status pages and their history stay as they are.",
  ),
  onFreeDescription: translationKey(
    "This project is on the Free plan, so it pays nothing for seats.",
  ),
  noFreePlanDescription: translationKey(
    "Contact support to cancel this plan. We will help you move the project to a plan that fits, or close it.",
  ),
  nothingDeleted: translationKey(
    "Features the Free plan does not include stop working, and nothing is deleted. They work again when you change back to a plan that includes them.",
  ),
  usageStillBilled: translationKey(
    "Usage is still billed as you go on the Free plan: the data your services send, and every monitor that is not a Manual monitor.",
  ),
  askSupport: translationKey(
    "Questions about your bill, or want to stop using OneUptime? Contact support and we will help.",
  ),
  switchButton: translationKey("Switch to Free Plan"),
  contactSupportButton: translationKey("Contact Support"),
  confirmTitle: translationKey("Switch to the Free plan?"),
  confirmDescription: translationKey(
    "The project stops paying for seats from now on. Features the Free plan does not include stop working, and nothing is deleted.",
  ),
  switched: translationKey("This project is now on the Free plan."),
};

/*
 * The Free plan's price on the period the project is billed for, so a
 * project billed yearly stays yearly. Null when the server sells no free
 * plan.
 */
export const getFreePlanIdFor: (input: {
  plans: Array<SubscriptionPlan>;
  currentPlanId: string | null;
}) => string | null = (input: {
  plans: Array<SubscriptionPlan>;
  currentPlanId: string | null;
}): string | null => {
  const isYearly: boolean = input.plans.some((plan: SubscriptionPlan) => {
    return (
      Boolean(input.currentPlanId) &&
      plan.getYearlyPlanId() === input.currentPlanId
    );
  });

  for (const period of isYearly
    ? [BillingPeriod.Yearly, BillingPeriod.Monthly]
    : [BillingPeriod.Monthly, BillingPeriod.Yearly]) {
    for (const plan of input.plans) {
      if (!plan.isCustomPricing() && isPlanFree(plan, period)) {
        return period === BillingPeriod.Yearly
          ? plan.getYearlyPlanId()
          : plan.getMonthlyPlanId();
      }
    }
  }

  return null;
};

// Whether the project's plan is one that costs nothing.
export const isOnFreePlan: (input: {
  plans: Array<SubscriptionPlan>;
  currentPlanId: string | null;
}) => boolean = (input: {
  plans: Array<SubscriptionPlan>;
  currentPlanId: string | null;
}): boolean => {
  return input.plans.some((plan: SubscriptionPlan) => {
    if (plan.isCustomPricing()) {
      return false;
    }

    return (
      (plan.getMonthlyPlanId() === input.currentPlanId &&
        isPlanFree(plan, BillingPeriod.Monthly)) ||
      (plan.getYearlyPlanId() === input.currentPlanId &&
        isPlanFree(plan, BillingPeriod.Yearly))
    );
  });
};

export interface ComponentProps {
  plans: Array<SubscriptionPlan>;
  currentPlanId: string | null;
  /*
   * What the move to Free stops, in sentences (API keys, SCIM): the plan
   * picker's note for the Free plan. Null when it stops nothing listed.
   */
  freePlanStopNote: string | null;
  /*
   * Why the person may not change the plan, when they may not: the button
   * stays, locked, and says so.
   */
  lockedReason?: string | undefined;
  /*
   * Before the dialog opens: false stops it (no payment method yet, which
   * the page asks for instead, as Change Plan does).
   */
  onBeforeSwitch: () => boolean;
  // Moves the project to the plan; throws with what went wrong.
  onSwitch: (freePlanId: string) => Promise<void>;
}

const CancelPlanCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [showConfirm, setShowConfirm] = useState<boolean>(false);
  const [isSwitching, setIsSwitching] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const freePlanId: string | null = getFreePlanIdFor({
    plans: props.plans,
    currentPlanId: props.currentPlanId,
  });
  const onFree: boolean = isOnFreePlan({
    plans: props.plans,
    currentPlanId: props.currentPlanId,
  });
  const canSwitch: boolean = Boolean(freePlanId) && !onFree;

  const contactSupport: CardButtonSchema = {
    title: CancelPlanCopy.contactSupportButton,
    buttonStyle: ButtonStyleType.NORMAL,
    icon: IconProp.Email,
    onClick: () => {
      Navigation.navigate(URL.fromString(`mailto:${SUPPORT_EMAIL}`), {
        openInNewTab: true,
      });
    },
  };

  const buttons: Array<CardButtonSchema> = canSwitch
    ? [
        {
          title: CancelPlanCopy.switchButton,
          buttonStyle: ButtonStyleType.NORMAL,
          icon: IconProp.ArrowCircleDown,
          disabled: Boolean(props.lockedReason),
          tooltip: props.lockedReason,
          onClick: () => {
            if (props.lockedReason || !props.onBeforeSwitch()) {
              return;
            }
            setError(undefined);
            setShowConfirm(true);
          },
        },
        contactSupport,
      ]
    : [contactSupport];

  let description: string = CancelPlanCopy.noFreePlanDescription;

  if (onFree) {
    description = CancelPlanCopy.onFreeDescription;
  } else if (canSwitch) {
    description = CancelPlanCopy.switchDescription;
  }

  const sentences: Array<string> = [];

  if (canSwitch) {
    sentences.push(CancelPlanCopy.nothingDeleted);
  }

  if (canSwitch || onFree) {
    sentences.push(CancelPlanCopy.usageStillBilled, CancelPlanCopy.askSupport);
  }

  return (
    <>
      <Card
        title={CancelPlanCopy.title}
        description={description}
        buttons={buttons}
      >
        {sentences.length > 0 ? (
          <ul
            className="list-disc space-y-1 ps-5 text-sm text-gray-600"
            data-testid="cancel-plan-facts"
          >
            {sentences.map((sentence: string) => {
              return (
                <li key={sentence}>
                  {translator.translateText(sentence) || sentence}
                </li>
              );
            })}
          </ul>
        ) : undefined}
      </Card>

      {showConfirm && freePlanId ? (
        <ConfirmModal
          title={CancelPlanCopy.confirmTitle}
          description={
            <div className="space-y-2">
              <p>
                {translator.translateText(CancelPlanCopy.confirmDescription) ||
                  CancelPlanCopy.confirmDescription}
              </p>
              {props.freePlanStopNote ? <p>{props.freePlanStopNote}</p> : <></>}
              <p>
                {translator.translateText(CancelPlanCopy.usageStillBilled) ||
                  CancelPlanCopy.usageStillBilled}
              </p>
            </div>
          }
          submitButtonText={CancelPlanCopy.switchButton}
          isLoading={isSwitching}
          error={error}
          onClose={() => {
            setShowConfirm(false);
          }}
          onSubmit={async () => {
            setIsSwitching(true);
            setError(undefined);
            try {
              await props.onSwitch(freePlanId);
              setShowConfirm(false);
            } catch (err) {
              setError((err as Error)?.message || String(err));
            }
            setIsSwitching(false);
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default CancelPlanCard;
