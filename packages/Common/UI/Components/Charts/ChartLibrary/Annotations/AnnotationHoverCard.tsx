import React from "react";
import FormattedTimeReferenceLine from "../Types/FormattedTimeReferenceLine";
import { AnnotationHover } from "./ChartAnnotationLayer";
import { clampHoverCardLeft, getMarkerColor } from "./AnnotationLayout";
import { cx } from "../Utils/Cx";

/*
 * Wide enough for an incident title at 12px without wrapping to three
 * lines, narrow enough that two cards could sit side by side on a
 * dashboard widget.
 */
export const HOVER_CARD_WIDTH: number = 288;

/** Clear of the chip's ring, so the card never covers what opened it. */
const HOVER_CARD_TOP_GAP: number = 6;

export interface AnnotationHoverCardProps {
  hover: AnnotationHover;
  /** Keeps the card open while the pointer travels from chip to card. */
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  /** Closes the card; Escape and an activated row both use it. */
  onDismiss: () => void;
}

/**
 * The card behind a rail chip or a region pill.
 *
 * This is where an event's label lives now. The old inline labels had to
 * fit in the plot, which is why they were rotated, truncated, and hidden
 * outright past six markers; an HTML card over the chart has none of those
 * limits, so the full title, its subtitle and its link all fit.
 */
const AnnotationHoverCard: React.FunctionComponent<AnnotationHoverCardProps> = (
  props: AnnotationHoverCardProps,
): React.ReactElement => {
  const { hover } = props;

  const left: number = clampHoverCardLeft({
    anchorX: hover.anchorX,
    cardWidth: HOVER_CARD_WIDTH,
    chartWidth: hover.chartWidth,
  });

  const regionSubtitle: string | undefined = hover.region?.original.subtitle;
  const rows: Array<FormattedTimeReferenceLine> = hover.markers;

  /*
   * A card opened from the keyboard takes focus, so a cluster's events are
   * reachable by Tab; one opened by hover leaves focus where it was, so a
   * passing pointer never yanks it.
   */
  const firstRowRef: React.RefObject<HTMLButtonElement> =
    React.useRef<HTMLButtonElement>(null);
  const shouldTakeFocus: boolean = Boolean(hover.takeFocus);

  React.useEffect((): void => {
    if (shouldTakeFocus) {
      firstRowRef.current?.focus();
    }
  }, [shouldTakeFocus, hover.id]);

  return (
    <div
      data-testid="chart-annotation-hover-card"
      className={cx(
        "pointer-events-auto absolute z-20 rounded-md border text-sm shadow-md",
        "border-gray-200",
        "bg-white",
      )}
      style={{
        left: `${left}px`,
        top: `${hover.anchorY + HOVER_CARD_TOP_GAP}px`,
        width: `${HOVER_CARD_WIDTH}px`,
      }}
      onMouseEnter={props.onMouseEnter}
      onMouseLeave={props.onMouseLeave}
      /*
       * Focus moving into the card blurs the chip that opened it, and the
       * chip's blur schedules the close. These cancel and re-arm that on
       * the card's own terms, which is what makes a clustered event
       * reachable by keyboard at all: without them the card would shut
       * 140ms after taking focus, taking the focus with it.
       */
      onFocus={props.onMouseEnter}
      onBlur={props.onMouseLeave}
      onKeyDown={(event: React.KeyboardEvent): void => {
        if (event.key === "Escape") {
          event.stopPropagation();
          props.onDismiss();
        }
      }}
    >
      <div className={cx("border-b border-inherit px-3 py-2")}>
        <p className={cx("truncate font-medium", "text-gray-900")}>
          {hover.heading}
        </p>
        {rows.length > 1 ? (
          <p className={cx("text-xs", "text-gray-500")}>{rows.length} events</p>
        ) : null}
        {regionSubtitle ? (
          <p className={cx("truncate text-xs", "text-gray-500")}>
            {regionSubtitle}
          </p>
        ) : null}
      </div>

      {/*
       * The row list is capped tight: the card sits over the plot while it
       * is open, and every pixel of it is a pixel the reader cannot
       * drag-select or hover for a value. A long cluster scrolls.
       */}
      {rows.length > 0 ? (
        <div className={cx("max-h-44 overflow-y-auto py-1")}>
          {rows.map(
            (
              marker: FormattedTimeReferenceLine,
              index: number,
            ): React.ReactElement => {
              const onClick: (() => void) | undefined = marker.original.onClick;
              const label: string = marker.original.label || "Event";

              return (
                <button
                  key={`annotation-row-${index}`}
                  ref={index === 0 ? firstRowRef : undefined}
                  type="button"
                  data-testid="chart-annotation-hover-row"
                  disabled={!onClick}
                  className={cx(
                    "flex w-full items-start gap-2 px-3 py-1.5 text-left",
                    onClick
                      ? "cursor-pointer hover:bg-gray-50"
                      : "cursor-default",
                  )}
                  onClick={(event: React.MouseEvent): void => {
                    event.stopPropagation();
                    onClick?.();
                  }}
                >
                  <span
                    aria-hidden="true"
                    className={cx("mt-1 h-2 w-2 shrink-0 rounded-full")}
                    style={{ backgroundColor: getMarkerColor(marker) }}
                  />
                  <span className={cx("min-w-0 flex-1")}>
                    <span
                      className={cx(
                        "block text-xs font-medium",
                        "text-gray-900",
                      )}
                    >
                      {label}
                    </span>
                    {marker.original.subtitle ? (
                      <span
                        className={cx(
                          "block truncate text-xs",
                          "text-gray-500",
                        )}
                      >
                        {marker.original.subtitle}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            },
          )}
        </div>
      ) : null}
    </div>
  );
};

export default AnnotationHoverCard;
