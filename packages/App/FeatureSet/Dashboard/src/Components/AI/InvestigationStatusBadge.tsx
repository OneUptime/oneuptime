import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { getListSeparator } from "Common/UI/Utils/ListSeparator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What the badge's mark says, named by meaning rather than by colour:
 *  - "live": the run can still move (queued, investigating, preparing the
 *    report), so the mark pulses;
 *  - "checking": the panel is still asking whether a run exists;
 *  - "done": the run reported;
 *  - "idle": nothing ran, and nothing is wrong with the page;
 *  - "waiting": an investigation rule makes OneUptime AI wait before it
 *    investigates (issue #5074): calm, nothing moves until the wait ends;
 *  - "attention": something is missing that a reader should notice (a run
 *    without a report, a status that could not be loaded);
 *  - "failed": the run stopped before it could report.
 */
export type InvestigationStatusIndicator =
  | "live"
  | "checking"
  | "done"
  | "idle"
  | "waiting"
  | "attention"
  | "failed";

export interface ComponentProps {
  // English, translated here like a Pill's text.
  text: string;
  indicator: InvestigationStatusIndicator;
  /*
   * English, the pill's name for screen readers. The AI card's two steps
   * each have one ("Investigation status", "Remediation status").
   */
  ariaLabel?: string | undefined;
  // The pill's test id: AiCardStep gives each step's its own.
  testId?: string | undefined;
}

/*
 * The test ids of the pill's two parts: what a screen reader hears before
 * the words (its name), and the words everyone reads.
 */
export const STATUS_BADGE_LABEL_TEST_ID: string = "status-badge-label";
export const STATUS_BADGE_WORDS_TEST_ID: string = "status-badge-words";

const ICON_CLASS_NAME: string = "h-3.5 w-3.5 flex-shrink-0";

export function renderInvestigationStatusIndicator(
  indicator: InvestigationStatusIndicator,
): ReactElement {
  if (indicator === "live") {
    return (
      <span aria-hidden="true" className="relative flex h-2 w-2 flex-shrink-0">
        <span className="absolute inline-flex h-full w-full rounded-full bg-indigo-500 opacity-75 motion-safe:animate-ping" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-500" />
      </span>
    );
  }

  if (indicator === "checking") {
    return (
      <Icon
        icon={IconProp.Refresh}
        className={`${ICON_CLASS_NAME} text-gray-400 motion-safe:animate-spin`}
      />
    );
  }

  if (indicator === "done") {
    return (
      <Icon
        icon={IconProp.Check}
        className={`${ICON_CLASS_NAME} text-green-600`}
      />
    );
  }

  if (indicator === "waiting") {
    return (
      <Icon
        icon={IconProp.Clock}
        className={`${ICON_CLASS_NAME} text-indigo-500`}
      />
    );
  }

  if (indicator === "failed") {
    return (
      <Icon
        icon={IconProp.Alert}
        className={`${ICON_CLASS_NAME} text-red-600`}
      />
    );
  }

  return (
    <Icon
      icon={IconProp.Info}
      className={`${ICON_CLASS_NAME} ${
        indicator === "attention" ? "text-amber-500" : "text-gray-400"
      }`}
    />
  );
}

/*
 * The neutral pill itself: each step of the AI card draws one
 * (AiCardStep), so the investigation's and the remediation's read the same
 * way.
 */
export const STATUS_BADGE_CLASS_NAME: string =
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-200";

/*
 * A step's status on the AI card, beside the step's title in every state
 * (AiCardStep). Every state gets the same neutral pill; only the small mark
 * in front of the words carries colour. The card used to change the whole pill's colour
 * with the state (green, indigo, red, amber), which added one more tinted
 * shape to a card that already had several.
 *
 * Its name - "Investigation status" - is words a screen reader hears before
 * the status, hidden on screen: an aria-label on a plain div is a name no
 * screen reader says (a div has no role to name), so "Reported" was heard
 * with nothing to say what it was the status of. The two are apart by the
 * separator of the name's own script ("Investigation status, Reported",
 * "وضعیت بررسی، ..."), so they are never read as one phrase.
 *
 * A div, not a span: Icon renders its own div around the svg.
 */
const InvestigationStatusBadge: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const label: string =
    translator.translateText(props.ariaLabel || "Investigation status") ||
    props.ariaLabel ||
    "Investigation status";

  return (
    <div
      {...(props.testId ? { "data-testid": props.testId } : {})}
      data-indicator={props.indicator}
      className={STATUS_BADGE_CLASS_NAME}
    >
      {renderInvestigationStatusIndicator(props.indicator)}
      <span data-testid={STATUS_BADGE_LABEL_TEST_ID} className="sr-only">
        {`${label}${getListSeparator([label])}`}
      </span>
      <span data-testid={STATUS_BADGE_WORDS_TEST_ID}>
        {translator.translateText(props.text)}
      </span>
    </div>
  );
};

export default InvestigationStatusBadge;
