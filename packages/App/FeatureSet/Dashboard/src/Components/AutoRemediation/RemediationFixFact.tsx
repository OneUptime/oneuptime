import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * ONE FACT ABOUT A FIX, ON THE AI CARD'S REMEDIATION STEP (block 43).
 *
 * Where a fix stands ("Waiting for approval"), how its recovery was
 * verified, and, for each of its commands, how risky it is ("safe change"),
 * whether it waits for approval or ran without it, and how it went: a
 * coloured dot and its words, never a pill. The step's own status is the
 * card's one pill (AiCardStep); a fix with three commands drew a dozen
 * tinted pills under it, in rows that wrapped into each other on a phone.
 * As words, they read as a line of the card - the One AI card's rule is
 * that nothing inside it is a box or a pill row - and the colour stays
 * where it means something: the dot.
 *
 * A failure, or a command the policy denies, is said in red as well: the
 * one fact on the step that must not be read past.
 */

export interface RemediationFixFactVisual {
  // English, translated where it is drawn.
  label: string;
  /*
   * The dot's colour: a saturated 400-600 shade, which reads the same in
   * the light and the dark theme.
   */
  dot: string;
  // Said in red too: it failed, or the policy denies it.
  isAlarming?: boolean | undefined;
}

export const REMEDIATION_FIX_FACT_CLASS_NAME: string =
  "inline-flex min-w-0 items-center gap-1.5 text-xs font-medium";

export const REMEDIATION_FIX_FACT_TEXT_CLASS_NAME: string = "text-gray-600";

export const REMEDIATION_FIX_FACT_ALARMING_TEXT_CLASS_NAME: string =
  "text-rose-700";

export interface ComponentProps {
  visual: RemediationFixFactVisual;
  // English that replaces the visual's own words (a plan's "No safe fix found").
  label?: string | undefined;
  testId?: string | undefined;
}

const RemediationFixFact: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <span
      data-testid={props.testId || "remediation-fix-fact"}
      data-alarming={props.visual.isAlarming ? "true" : "false"}
      className={`${REMEDIATION_FIX_FACT_CLASS_NAME} ${
        props.visual.isAlarming
          ? REMEDIATION_FIX_FACT_ALARMING_TEXT_CLASS_NAME
          : REMEDIATION_FIX_FACT_TEXT_CLASS_NAME
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-1.5 w-1.5 flex-none rounded-full ${props.visual.dot}`}
      />
      <span className="break-words">
        {translator.translateText(props.label || props.visual.label)}
      </span>
    </span>
  );
};

export default RemediationFixFact;
