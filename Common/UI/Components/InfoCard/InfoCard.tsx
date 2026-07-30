import FieldLabelElement from "../Detail/FieldLabel";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  title: string;
  value: string | ReactElement;
  className?: string;
  textClassName?: string;
  onClick?: (() => void) | undefined;
  /*
   * Only meaningful alongside `onClick`: renders the card as a pressed toggle
   * — outlined, and announced as such. Used by summary strips where clicking a
   * tile narrows the table below it, so the tile has to show which subset the
   * user is looking at.
   *
   * Leave it undefined on a card that navigates instead of toggling. Most
   * clickable InfoCards in the product are one-way links, and announcing one
   * as an unpressed toggle promises a state that activating it never produces.
   */
  isSelected?: boolean | undefined;
  // Announced in place of the title when the card is clickable.
  ariaLabel?: string | undefined;
}

const InfoCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isClickable: boolean = Boolean(props.onClick);

  /*
   * A selected card swaps its border rather than adding one: Tailwind emits
   * both border-color utilities at the same specificity, so stacking them
   * leaves the winner up to stylesheet order.
   */
  const borderClassName: string =
    isClickable && props.isSelected
      ? "border-indigo-500 ring-1 ring-indigo-500"
      : "border-gray-200";

  return (
    <div
      onClick={props.onClick}
      /*
       * Click handlers on a div are invisible to the keyboard and to screen
       * readers. Everything below turns a clickable card into a real toggle
       * button; a card with no handler is left as the plain container it is.
       */
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      /*
       * Gated on the prop being supplied, not merely on clickability: the
       * cards that were already clickable before toggles existed (the Home
       * overview stats, the Kubernetes and Proxmox summaries) all navigate,
       * and `aria-pressed="false"` would announce each of them as a toggle
       * that is currently off — a state activating it never reaches.
       */
      aria-pressed={
        isClickable && props.isSelected !== undefined
          ? Boolean(props.isSelected)
          : undefined
      }
      aria-label={isClickable ? props.ariaLabel : undefined}
      onKeyDown={
        isClickable
          ? (event: React.KeyboardEvent<HTMLDivElement>) => {
              if (event.key !== "Enter" && event.key !== " ") {
                return;
              }
              // Space scrolls the page unless the default is taken away.
              event.preventDefault();
              props.onClick?.();
            }
          : undefined
      }
      className={`rounded-xl bg-white border ${borderClassName} shadow-sm hover:shadow-md transition-shadow duration-200 p-5 ${isClickable ? "cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2" : ""} ${props.className || ""}`}
    >
      <div className="mb-2">
        <FieldLabelElement title={props.title} />
      </div>
      <div className={props.textClassName || "text-gray-900"}>
        {props.value}
      </div>
    </div>
  );
};

export default InfoCard;
