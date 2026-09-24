import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "../../../Types/Icon/IconProp";
import Icon from "../Icon/Icon";
import Tooltip from "./Tooltip";

/*
 * A small (i) beside a label that explains it on hover or keyboard focus -
 * "what does p95 mean?" answered where the number is, rather than in the
 * docs. Built for metric tiles and chart headers, but nothing here is
 * metric-specific.
 *
 * The trigger is a real <button> so it is reachable with Tab and announced
 * as a control; Tippy shows the text on focus as well as on hover and links
 * it with aria-describedby. It is lazy: an overview page draws dozens of
 * these, and none of them needs a Tippy instance until someone reaches for
 * it.
 *
 * A click is swallowed: the (i) can sit inside a card that is itself a
 * link, and asking what a number means should not navigate away from it.
 */

export interface ComponentProps {
  // The explanation. Nothing renders when it is empty.
  text?: string | undefined;
  /*
   * What is being explained, e.g. the metric's title. Names the button for
   * screen readers ("About p95 duration") and is never shown.
   */
  label: string;
  className?: string | undefined;
  iconClassName?: string | undefined;
  dataTestId?: string | undefined;
}

const InfoTooltip: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const text: string = (props.text || "").trim();

  if (!text) {
    return <></>;
  }

  return (
    <Tooltip text={text} lazy={true}>
      <button
        type="button"
        aria-label={`About ${props.label}`}
        data-testid={props.dataTestId}
        className={`inline-flex flex-shrink-0 items-center justify-center rounded-full text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:text-gray-600 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 ${
          props.className || ""
        }`}
        onClick={(event: React.MouseEvent<HTMLButtonElement>): void => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <Icon
          icon={IconProp.InformationCircle}
          className={props.iconClassName || "h-3.5 w-3.5"}
        />
      </button>
    </Tooltip>
  );
};

export default InfoTooltip;
