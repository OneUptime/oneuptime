import {
  CHANGE_PLAN_BILLING_NOTE_TEST_ID,
  ChangePlanBillingCopy,
  getRunningTrialEnd,
} from "./ChangePlanBilling";
import OneUptimeDate from "Common/Types/Date";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * In the Change Plan picker, under the plans: whether the project is still
 * on a free trial the change keeps, and when it ends - or, when it is not,
 * that changing plan does not start one and what is billed straight away
 * (Components/Billing/ChangePlanBilling).
 */

export interface ComponentProps {
  trialEndsAt: Date | string | null | undefined;
}

const ChangePlanBillingNote: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const runningTrialEnd: Date | null = getRunningTrialEnd(props.trialEndsAt);

  if (runningTrialEnd) {
    return (
      <Alert
        type={AlertType.INFO}
        className="mt-4"
        dataTestId={CHANGE_PLAN_BILLING_NOTE_TEST_ID}
        strongTitle={ChangePlanBillingCopy.trialTitle}
        title={
          <p>
            {translator.translateTemplate(
              ChangePlanBillingCopy.trialDescription,
              {
                date: OneUptimeDate.getDateAsLocalFormattedString(
                  runningTrialEnd,
                  true,
                ),
              },
            )}
          </p>
        }
      />
    );
  }

  return (
    <Alert
      type={AlertType.WARNING}
      className="mt-4"
      dataTestId={CHANGE_PLAN_BILLING_NOTE_TEST_ID}
      strongTitle={ChangePlanBillingCopy.noTrialTitle}
      title={
        <p>
          {translator.translateText(ChangePlanBillingCopy.noTrialDescription)}
        </p>
      }
    />
  );
};

export default ChangePlanBillingNote;
