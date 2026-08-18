import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A segmented control whose options carry a status colour and a live
 * count: "All 42 · Needs attention 5 · Down 3 · Degraded 2".
 *
 * One control doing two jobs on purpose. Read left to right it is a
 * status line — how many things there are and how many of them are in
 * trouble — without scanning a single node or card. Pressed, it is the
 * filter that narrows the view to exactly those. Splitting the summary
 * from the control would mean seeing "3 down" and then hunting for the
 * thing that shows you which three.
 *
 * Purely presentational, and shared by the network topology map and the
 * network site map so the two read as the same control rather than as two
 * filters that happen to rhyme.
 */

export interface StatusChipOption {
  value: string;
  label: string;
  /** Long-form help, shown as the chip's title attribute. */
  description: string;
  /** The status dot's colour; omitted for an option that means "no state". */
  color?: string | undefined;
  count: number;
  testId: string;
}

export interface ComponentProps {
  options: Array<StatusChipOption>;
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  dataTestId?: string | undefined;
  /*
   * Options whose count is zero but which are still offered. They render
   * muted so the eye lands on the chip that has something to say. Set
   * false where a zero is itself the headline.
   */
  muteEmptyOptions?: boolean | undefined;
}

const StatusChipGroup: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const muteEmpty: boolean = props.muteEmptyOptions !== false;

  return (
    <div
      role="group"
      aria-label={translateString(props.ariaLabel) || props.ariaLabel}
      data-testid={props.dataTestId}
      /*
       * flex-wrap, like the layout-mode group this borrows its shell
       * from: chips carrying counts are wider than plain pills, and a
       * chip that overflows its card is unreachable rather than merely
       * cramped.
       */
      className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-gray-200 bg-gray-50 p-0.5"
    >
      {props.options.map((option: StatusChipOption): ReactElement => {
        const isActive: boolean = props.value === option.value;
        const isEmpty: boolean = muteEmpty && option.count === 0 && !isActive;

        return (
          <button
            key={option.value}
            type="button"
            title={option.description}
            aria-pressed={isActive}
            data-testid={option.testId}
            /*
             * The ring is load-bearing in dark mode: the raised chip is
             * DARKER than the track behind it there, so without an
             * outline the selected option all but disappears.
             */
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              isActive
                ? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200"
                : isEmpty
                  ? "text-gray-400 hover:text-gray-600"
                  : "text-gray-500 hover:text-gray-800"
            }`}
            onClick={() => {
              props.onChange(option.value);
            }}
          >
            {option.color ? (
              <span
                aria-hidden={true}
                className="h-2 w-2 flex-shrink-0 rounded-full"
                style={{
                  backgroundColor: option.color,
                  // A zero count reads as absent, not as a colour.
                  opacity: isEmpty ? 0.35 : 1,
                }}
              />
            ) : (
              <></>
            )}
            <span>{translateString(option.label) || option.label}</span>
            <span
              className={`tabular-nums ${
                isActive ? "text-gray-500" : "text-gray-400"
              }`}
            >
              {option.count}
            </span>
          </button>
        );
      })}
    </div>
  );
};

export default StatusChipGroup;
