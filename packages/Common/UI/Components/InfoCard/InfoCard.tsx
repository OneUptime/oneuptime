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
  // What the value means, shown in an (i) tooltip beside the title.
  tooltip?: string | undefined;
  dataTestId?: string | undefined;
  /*
   * The card's padding, p-5 when left out. A card that is one of many in a
   * narrow grid (a monitor's summary facts) takes less on a phone.
   */
  paddingClassName?: string | undefined;
}

/*
 * A value with no place to break - a 64-character container ID, a digest, a
 * long hostname - used to run out of its card, and out of the grid the
 * cards sit in, on a phone (a Swarm task's Container ID, follow-up of
 * #5076). It breaks anywhere it has to, which also lets the card shrink to
 * its grid column; text that fits is drawn exactly as before.
 */
export const INFO_CARD_VALUE_WRAP_CLASS_NAME: string =
  "min-w-0 [overflow-wrap:anywhere]";

const InfoCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isClickable: boolean = Boolean(props.onClick);
  const paddingClassName: string = props.paddingClassName || "p-5";

  /*
   * A selected card swaps its border rather than adding one: Tailwind emits
   * both border-color utilities at the same specificity, so stacking them
   * leaves the winner up to stylesheet order.
   */
  const borderClassName: string =
    isClickable && props.isSelected
      ? "border-indigo-500 ring-1 ring-indigo-500"
      : "border-gray-200";

  /*
   * A clickable card with a tooltip cannot stay a role="button" div: the (i)
   * is a button of its own, and a button's children are presentational, so
   * screen readers would never reach it. The card becomes a plain container
   * with a real button laid over it, and the (i) sits above that button
   * (FieldLabel lifts it with relative z-10). Cards without a tooltip keep
   * the markup below, unchanged.
   */
  if (isClickable && props.tooltip?.trim()) {
    return (
      <div
        className={`relative rounded-xl bg-white border ${borderClassName} shadow-sm hover:shadow-md transition-shadow duration-200 ${paddingClassName} ${props.className || ""}`}
        data-testid={props.dataTestId}
      >
        <button
          type="button"
          onClick={props.onClick}
          aria-pressed={
            props.isSelected !== undefined
              ? Boolean(props.isSelected)
              : undefined
          }
          /*
           * Named like the old role="button" card, which read its title and
           * value - unless the value is an element, which has no text to
           * borrow here.
           */
          aria-label={
            props.ariaLabel ||
            (typeof props.value === "string"
              ? `${props.title} ${props.value}`
              : props.title)
          }
          className="absolute inset-0 rounded-xl cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        />
        <div className="mb-2">
          <FieldLabelElement
            title={props.title}
            tooltip={props.tooltip}
            isCardStyle={true}
          />
        </div>
        <div
          data-testid="info-card-value"
          className={`${INFO_CARD_VALUE_WRAP_CLASS_NAME} ${props.textClassName || "text-gray-900"}`}
        >
          {props.value}
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid={props.dataTestId}
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
      className={`rounded-xl bg-white border ${borderClassName} shadow-sm hover:shadow-md transition-shadow duration-200 ${paddingClassName} ${isClickable ? "cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2" : ""} ${props.className || ""}`}
    >
      {/*
       * The name in sentence case, muted, over the value: no tracked
       * capitals and no dot ("READY •"), as a detail card writes its names.
       */}
      <div className="mb-2">
        <FieldLabelElement
          title={props.title}
          tooltip={props.tooltip}
          isCardStyle={true}
        />
      </div>
      <div
        data-testid="info-card-value"
        className={`${INFO_CARD_VALUE_WRAP_CLASS_NAME} ${props.textClassName || "text-gray-900"}`}
      >
        {props.value}
      </div>
    </div>
  );
};

export default InfoCard;
