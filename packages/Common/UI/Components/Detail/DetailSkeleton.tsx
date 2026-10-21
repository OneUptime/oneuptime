import {
  getDetailCellClassNames,
  getDetailCellSpan,
  getDetailColumnCount,
  getDetailGridClassName,
} from "./DetailGridLayout";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What a detail card shows while its record loads: its fields' rows, in
 * the grid they will fill, with a grey bar for each name and value.
 *
 * It used to be a thin bar spinning in a 100px gap, which the fields then
 * replaced at their own height - the card, and everything under it on the
 * page, jumped as each card loaded. The skeleton is laid out by the rules
 * the fields are (DetailGridLayout), one cell for each field the card will
 * draw, each as tall as a one-line field, so the card opens at about the
 * size it ends at.
 *
 * It says "Loading" to a screen reader, as the bar did.
 */

export const DETAIL_SKELETON_TEST_ID: string = "detail-skeleton";

// The most rows a skeleton draws: a card of 30 fields does not need 30 bars.
export const MAX_DETAIL_SKELETON_CELLS: number = 12;

// Each bar a little different, so the rows read as rows of text.
const NAME_WIDTH_CLASS_NAMES: ReadonlyArray<string> = [
  "w-20",
  "w-28",
  "w-24",
  "w-32",
];

const VALUE_WIDTH_CLASS_NAMES: ReadonlyArray<string> = [
  "w-40",
  "w-56",
  "w-32",
  "w-48",
];

export const DETAIL_SKELETON_BAR_CLASS_NAME: string =
  "max-w-full rounded bg-gray-100";

export interface ComponentProps {
  // Each field's colSpan, in order (undefined is one column).
  spans: ReadonlyArray<number | undefined>;
  columns?: number | undefined;
  // The overview pages' denser rows (DetailStyle.Compact).
  isCompact?: boolean | undefined;
}

const DetailSkeleton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const spans: ReadonlyArray<number | undefined> =
    props.spans.length > 0
      ? props.spans.slice(0, MAX_DETAIL_SKELETON_CELLS)
      : [undefined];

  const nameBar: (index: number) => ReactElement = (
    index: number,
  ): ReactElement => {
    return (
      <div className="flex h-5 items-center">
        <div
          className={`h-3 ${
            NAME_WIDTH_CLASS_NAMES[index % NAME_WIDTH_CLASS_NAMES.length]
          } ${DETAIL_SKELETON_BAR_CLASS_NAME}`}
        />
      </div>
    );
  };

  const valueBar: (index: number) => ReactElement = (
    index: number,
  ): ReactElement => {
    return (
      <div className="mt-1 flex h-6 items-center">
        <div
          className={`h-3.5 ${
            VALUE_WIDTH_CLASS_NAMES[index % VALUE_WIDTH_CLASS_NAMES.length]
          } ${DETAIL_SKELETON_BAR_CLASS_NAME}`}
        />
      </div>
    );
  };

  /*
   * The compact style's rows, as Detail draws them: hairlines between rows
   * in one column, whitespace between cells when several share a row.
   */
  const columnCount: number = getDetailColumnCount(props.columns);
  const isSingleColumn: boolean = columnCount <= 1;

  const cells: Array<ReactElement> = props.isCompact
    ? spans.map((span: number | undefined, index: number): ReactElement => {
        return (
          <div
            key={index}
            className={`sm:col-span-${getDetailCellSpan(
              span,
              columnCount,
            )} min-w-0 py-3${isSingleColumn ? " first:pt-0 last:pb-0" : ""}`}
            data-testid={`${DETAIL_SKELETON_TEST_ID}-cell`}
          >
            {nameBar(index)}
            {valueBar(index)}
          </div>
        );
      })
    : getDetailCellClassNames(spans, props.columns).map(
        (className: string, index: number): ReactElement => {
          return (
            <div
              key={index}
              className={className}
              data-testid={`${DETAIL_SKELETON_TEST_ID}-cell`}
            >
              {nameBar(index)}
              {valueBar(index)}
            </div>
          );
        },
      );

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={translator.translateText("Loading")}
      data-testid={DETAIL_SKELETON_TEST_ID}
      className="animate-pulse"
    >
      <div
        aria-hidden="true"
        className={
          props.isCompact
            ? `grid grid-cols-1 ${
                isSingleColumn
                  ? "gap-0 divide-y divide-gray-100"
                  : "gap-0 divide-y divide-gray-100 sm:gap-x-6 sm:divide-y-0"
              } sm:grid-cols-${columnCount} w-full`
            : getDetailGridClassName(props.columns)
        }
      >
        {cells}
      </div>
      <span className="sr-only">{translator.translateText("Loading...")}</span>
    </div>
  );
};

export default DetailSkeleton;
