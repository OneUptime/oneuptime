import InvestigationStatusBadge, {
  InvestigationStatusIndicator,
} from "./InvestigationStatusBadge";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useId,
} from "react";

/*
 * ONE STEP OF THE AI CARD (block 43).
 *
 * An incident's or alert's AI card says what OneUptime AI did in two
 * steps, one under the other: 1 Investigation, 2 Remediation - "you could
 * clearly see what the investigation was and what AI is doing to remediate
 * stuff as well". Each step is a numbered mark on a rail, its title and
 * its status pill on one line, and its body under them. The rail joins the
 * first step's mark to the second's, so the two read as one sequence, and
 * the mark says how the step went at a glance: a check once it is done, its
 * number otherwise, tinted while it moves, needs the reader or failed.
 *
 * From sm up the body sits under the title, beside the rail. On a phone it
 * takes the card's whole width under the mark, as a message of the card's
 * conversation does, and the rail is left out: a report indented past the
 * marks left a 320px phone some 200px of text, and a verdict that did not
 * fit.
 *
 * Nothing here is a box: the card is the only frame (the One AI card's
 * rule), the marks are marks.
 */

export interface AiCardStepStatus {
  // English, translated by the pill.
  text: string;
  indicator: InvestigationStatusIndicator;
}

export interface ComponentProps {
  number: number;
  // English, translated here.
  title: string;
  status: AiCardStepStatus;
  // The pill's name for screen readers: "Investigation status".
  statusLabel: string;
  // The last step draws no rail under its mark.
  isLast?: boolean | undefined;
  testId: string;
  /*
   * Given, the step's title can take the focus (tabIndex -1): the step puts
   * the keyboard's place there when a control it pressed is gone, such as
   * Try again once a fix started.
   */
  headingRef?: React.RefObject<HTMLHeadingElement | null> | undefined;
  children?: ReactNode | undefined;
}

/*
 * The mark's colours by what the step's status says. Light classes only:
 * Theme.css remaps each of them for the dark theme.
 */
export const AI_CARD_STEP_MARK_CLASS_NAMES: Record<
  InvestigationStatusIndicator,
  string
> = {
  done: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  live: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  attention: "bg-amber-50 text-amber-700 ring-amber-200",
  failed: "bg-red-50 text-red-700 ring-red-200",
  waiting: "bg-white text-gray-600 ring-gray-300",
  checking: "bg-white text-gray-600 ring-gray-300",
  idle: "bg-white text-gray-600 ring-gray-300",
};

const AiCardStep: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const headingId: string = useId();
  const indicator: InvestigationStatusIndicator = props.status.indicator;

  return (
    <section
      aria-labelledby={headingId}
      data-testid={props.testId}
      data-step={props.number}
      data-indicator={indicator}
      className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 sm:gap-x-4"
    >
      {/*
        The step's mark, and from sm up the rail down to the next one, beside
        the body.
      */}
      <div
        aria-hidden="true"
        className="col-start-1 row-start-1 flex flex-col items-center sm:row-end-3"
      >
        <div
          data-testid={`${props.testId}-mark`}
          className={`flex h-7 w-7 flex-none items-center justify-center rounded-full text-xs font-semibold ring-1 ring-inset ${AI_CARD_STEP_MARK_CLASS_NAMES[indicator]}`}
        >
          {indicator === "done" ? (
            <Icon icon={IconProp.Check} className="h-3.5 w-3.5" />
          ) : (
            <span>{props.number}</span>
          )}
        </div>
        {props.isLast ? (
          <></>
        ) : (
          <div
            data-testid={`${props.testId}-rail`}
            className="mt-2 w-px flex-1 bg-gray-200 max-sm:hidden"
          />
        )}
      </div>

      {/*
        The title sits level with the mark's middle, and the pill on its
        line while both fit - under it on a narrow card, still at the card's
        end edge, as a card header's actions go.
      */}
      <div className="col-start-2 row-start-1 flex min-h-7 min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <h3
          id={headingId}
          ref={props.headingRef}
          tabIndex={props.headingRef ? -1 : undefined}
          className="text-sm font-semibold leading-7 text-gray-900 focus:outline-none"
        >
          {translator.translateText(props.title)}
        </h3>
        <div
          data-testid={`${props.testId}-status`}
          className="ms-auto flex-none"
        >
          <InvestigationStatusBadge
            text={props.status.text}
            indicator={indicator}
            ariaLabel={props.statusLabel}
          />
        </div>
      </div>

      <div
        data-testid={`${props.testId}-body`}
        className={`col-span-2 col-start-1 row-start-2 mt-3 min-w-0 space-y-5 sm:col-span-1 sm:col-start-2 ${
          props.isLast ? "" : "pb-8"
        }`}
      >
        {props.children}
      </div>
    </section>
  );
};

export default AiCardStep;
