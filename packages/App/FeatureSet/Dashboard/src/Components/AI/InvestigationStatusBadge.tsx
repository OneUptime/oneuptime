import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
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
 *  - "attention": something is missing that a reader should notice (a run
 *    without a report, a status that could not be loaded);
 *  - "failed": the run stopped before it could report.
 */
export type InvestigationStatusIndicator =
  | "live"
  | "checking"
  | "done"
  | "idle"
  | "attention"
  | "failed";

export interface ComponentProps {
  // English, translated here like a Pill's text.
  text: string;
  indicator: InvestigationStatusIndicator;
}

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
 * The AI Investigation card's status, in the card header in every state.
 * Every state gets the same neutral pill; only the small mark in front of
 * the words carries colour. The card used to change the whole pill's colour
 * with the state (green, indigo, red, amber), which added one more tinted
 * shape to a card that already had several.
 *
 * A div, not a span: Icon renders its own div around the svg.
 */
const InvestigationStatusBadge: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      aria-label={translator.translateText("Investigation status")}
      data-indicator={props.indicator}
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-200"
    >
      {renderInvestigationStatusIndicator(props.indicator)}
      <span>{translator.translateText(props.text)}</span>
    </div>
  );
};

export default InvestigationStatusBadge;
