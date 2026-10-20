import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import {
  INVESTIGATE_NOW,
  INVESTIGATION_WAITING_COPY,
  WaitingInvestigationState,
  formatWaitUntil,
} from "./InvestigationWaitingState";

export interface ComponentProps {
  subjectType: "incident" | "alert";
  waiting: WaitingInvestigationState;
  // "Investigate now": start it at once. Offered to who may (canStartNow).
  onStartNow: () => void;
  isStarting: boolean;
  // Why the last "Investigate now" did not start it, as the server said.
  startError: string | null;
}

/*
 * What the AI Investigation card says while an investigation rule makes
 * OneUptime AI wait before it investigates the incident or alert (issue
 * #5074): when it investigates - if it is still open then - why it waits,
 * and, for whoever may change the record, Investigate now, which starts it
 * at once whatever the rule says.
 *
 * It is the card's body, as InvestigationNotStarted is: the panel draws the
 * one card, its header and its status pill, and closes it with the
 * conversation. Plain content, no box of its own.
 */
const InvestigationWaiting: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const copy: (typeof INVESTIGATION_WAITING_COPY)["incident"] =
    INVESTIGATION_WAITING_COPY[props.subjectType];

  return (
    <div
      aria-live="polite"
      data-testid="investigation-waiting"
      className="space-y-4"
    >
      <div>
        <h3 className="text-sm font-semibold text-gray-900">
          {translator.translateTemplate(copy.title, {
            time: formatWaitUntil(props.waiting.waitUntil),
          })}
        </h3>
        <p className="mt-1 text-sm leading-6 text-gray-600">
          {translator.translatePlural(
            copy.description,
            props.waiting.waitMinutes,
          )}
        </p>
      </div>

      {props.waiting.canStartNow ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {/*
           * The bordered default style reads as a button, as Open Fix PR's
           * does. Its side-by-side margin would only indent it here, and its
           * phone-sized text would wrap the label.
           */}
          <div className="flex-shrink-0 [&>button]:ml-0 [&>button]:text-sm [&>button]:md:ml-0">
            <Button
              title={INVESTIGATE_NOW}
              icon={IconProp.Play}
              buttonSize={ButtonSize.Normal}
              buttonStyle={ButtonStyleType.NORMAL}
              isLoading={props.isStarting}
              disabled={props.isStarting}
              onClick={props.onStartNow}
              dataTestId="investigate-now"
            />
          </div>
          {props.startError ? (
            <p
              role="alert"
              data-testid="investigate-now-error"
              className="text-sm leading-6 text-red-600"
            >
              {props.startError}
            </p>
          ) : null}
        </div>
      ) : (
        <p
          data-testid="investigate-now-who"
          className="text-xs leading-relaxed text-gray-500"
        >
          {translator.translateText(copy.whoCanStart)}
        </p>
      )}
    </div>
  );
};

export default InvestigationWaiting;
