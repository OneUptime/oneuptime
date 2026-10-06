import {
  getStoppedOnPlan,
  getStoppedSentences,
  PlanCutoffCopy,
  PlanCutoffCounts,
} from "./PlanCutoff";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * On the Billing page, above the plan: the API keys and SCIM connections
 * the project's plan has stopped, how many, and the plan that turns each
 * back on (Components/Billing/PlanCutoff). Nothing when nothing stopped -
 * a project on the plan, one with none of them, or counts not read.
 */

export const PLAN_CUTOFF_NOTE_TEST_ID: string = "plan-cutoff-note";

export interface ComponentProps {
  counts: PlanCutoffCounts | null;
  plan: PlanType | null;
}

const PlanCutoffNote: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (!props.counts) {
    return <></>;
  }

  const sentences: Array<string> = getStoppedSentences({
    translator,
    stopped: getStoppedOnPlan({ counts: props.counts, plan: props.plan }),
  });

  if (sentences.length === 0) {
    return <></>;
  }

  return (
    <Alert
      type={AlertType.WARNING}
      className="mb-5"
      dataTestId={PLAN_CUTOFF_NOTE_TEST_ID}
      strongTitle={PlanCutoffCopy.stoppedNoteTitle}
      title={
        <div className="space-y-1">
          {sentences.map((sentence: string) => {
            return <p key={sentence}>{sentence}</p>;
          })}
        </div>
      }
    />
  );
};

export default PlanCutoffNote;
