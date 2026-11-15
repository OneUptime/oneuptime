import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import { getTranslatedLineDirection } from "Common/UI/Utils/LineDirection";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import {
  INVESTIGATE_NOW,
  INVESTIGATION_WAITING_CLOCK_TICK_MS,
  INVESTIGATION_WAITING_COPY,
  InvestigationWaitingTitle,
  WaitingInvestigationState,
  getInvestigationWaitingTitle,
} from "./InvestigationWaitingState";

export interface ComponentProps {
  subjectType: "incident" | "alert";
  waiting: WaitingInvestigationState;
  // "Investigate now": start it at once. Offered to who may (canStartNow).
  onStartNow: () => void;
  isStarting: boolean;
  // Why the last "Investigate now" did not start it, as the server said.
  startError: string | null;
  /*
   * The button's id: the card puts the keyboard back on it once it has its
   * answer (InvestigationPanel), or on the step's title once it is gone.
   */
  startNowButtonId?: string | undefined;
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
  /*
   * The clock the heading is read against: it ticks, so "at 10:42" turns
   * into "shortly" when the time comes, rather than naming a time gone by
   * until the card's next read finds the run.
   */
  const [now, setNow] = useState<Date>(OneUptimeDate.getCurrentDate());

  useEffect(() => {
    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      setNow(OneUptimeDate.getCurrentDate());
    }, INVESTIGATION_WAITING_CLOCK_TICK_MS);

    return () => {
      clearInterval(interval);
    };
  }, []);

  const title: InvestigationWaitingTitle = getInvestigationWaitingTitle({
    subjectType: props.subjectType,
    waitUntil: props.waiting.waitUntil,
    now: now,
  });

  return (
    <div
      aria-live="polite"
      data-testid="investigation-waiting"
      className="space-y-4"
    >
      <div>
        <h3 className="text-sm font-semibold text-gray-900">
          {translator.translateTemplate(title.template, {
            time: title.time,
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
              {...(props.startNowButtonId
                ? { id: props.startNowButtonId }
                : {})}
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
          {/*
           * A refusal the Dashboard words reads as the page does, even when
           * it starts with a name in Latin letters ("OneUptime AI ..." in
           * Arabic and Persian); one it does not word is the server's
           * English, which on a page read from the right reads from the
           * left, so its full stop stays at its end
           * (getTranslatedLineDirection).
           */}
          {props.startError ? (
            <p
              role="alert"
              dir={getTranslatedLineDirection(
                props.startError,
                translator.language,
              )}
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
