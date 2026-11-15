import RelativeTime from "../EpisodeView/RelativeTime";
import { SetupHealthVerdictLook, VERDICT_LOOK } from "./SetupHealthLook";
import {
  SetupHealthVerdict,
  getSetupHealthVerdict,
  translateSetupHealthVerdictText,
} from "./SetupHealthWords";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { SetupHealthAnswer } from "Common/Types/SetupHealth/SetupHealth";
import { getHandDrawnButtonStateClassName } from "Common/UI/Components/Button/ButtonStates";
import Icon from "Common/UI/Components/Icon/Icon";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * THE TOP OF SETUP HEALTH (#8135): one line that says whether anything in
 * the setup would stop people from being told, and how badly, in the colour
 * of the worst level with findings - as Home opens with the worst thing
 * open (ProjectHealthCard). Beside it, when the setup was checked and
 * Recheck. The findings follow, level by level.
 */

export const SETUP_HEALTH_HEADLINE_ID: string = "setup-health-headline";

// The page's one Recheck: a bordered button, as Home's Try again is drawn.
const RECHECK_CLASS_NAME: string =
  "inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

export interface ComponentProps {
  answer: SetupHealthAnswer;
  isRechecking: boolean;
  onRecheck: () => void;
}

const SetupHealthSummary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const verdict: SetupHealthVerdict = getSetupHealthVerdict(
    props.answer.counts,
  );
  const look: SetupHealthVerdictLook = VERDICT_LOOK[verdict.kind];

  return (
    <section
      data-testid="setup-health-summary"
      data-verdict={verdict.kind}
      aria-labelledby={SETUP_HEALTH_HEADLINE_ID}
      aria-busy={props.isRechecking}
      className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
    >
      <div
        className={`flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-start sm:justify-between md:px-6 ${look.bandClassName}`}
      >
        <div className="flex min-w-0 items-start gap-4">
          <span
            aria-hidden="true"
            className={`flex h-11 w-11 flex-none items-center justify-center rounded-full ${look.discClassName}`}
          >
            <Icon icon={look.icon} className="h-6 w-6 text-white" />
          </span>
          <div className="min-w-0">
            <h2
              id={SETUP_HEALTH_HEADLINE_ID}
              data-testid="setup-health-headline"
              className="text-lg font-semibold text-gray-900 sm:text-xl"
            >
              {translateSetupHealthVerdictText(translator, verdict.headline, {
                isHeadline: true,
              })}
            </h2>
            <p
              data-testid="setup-health-verdict"
              className="mt-1 max-w-2xl text-sm text-gray-600"
            >
              {translateSetupHealthVerdictText(translator, verdict.summary)}
            </p>
          </div>
        </div>
        {/*
         * Under the verdict's words on a phone (the disc and its gap,
         * 3.75rem, before them); beside the verdict from sm up.
         */}
        <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 ps-[3.75rem] text-xs text-gray-500 sm:ps-0 sm:pt-1">
          <span data-testid="setup-health-checked">
            <TranslatedSentence
              template="Checked {{time}}"
              slots={{
                time: (
                  <RelativeTime
                    date={OneUptimeDate.fromString(props.answer.checkedAt)}
                  />
                ),
              }}
            />
          </span>
          <button
            type="button"
            className={`${RECHECK_CLASS_NAME} ${getHandDrawnButtonStateClassName(
              {
                isBusy: props.isRechecking,
                hoverClassName: "hover:bg-gray-50",
              },
            )}`.trim()}
            disabled={props.isRechecking}
            data-testid="setup-health-recheck"
            onClick={props.onRecheck}
          >
            <Icon
              icon={IconProp.Refresh}
              className={`h-3.5 w-3.5 flex-none ${
                props.isRechecking ? "motion-safe:animate-spin" : ""
              }`}
            />
            <span>
              {props.isRechecking
                ? translator.translateText("Checking...")
                : translator.translateText("Recheck")}
            </span>
          </button>
        </div>
      </div>
    </section>
  );
};

export default SetupHealthSummary;
