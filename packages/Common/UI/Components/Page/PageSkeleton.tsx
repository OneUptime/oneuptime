import { CARD_FRAME_CLASS_NAME, CARD_PADDING_CLASS_NAME } from "../Card/Card";
import { DETAIL_SKELETON_BAR_CLASS_NAME } from "../Detail/DetailSkeleton";
import { ChartSkeletonBars } from "../Skeleton/ChartSkeleton";
import { TableSkeletonBars } from "../Skeleton/TableSkeleton";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What a page's content area shows while the page loads: the card it
 * opens with, drawn as grey bars where its title, description and first
 * fields will be.
 *
 * It used to be PageLoader, a thin bar 208px down an empty area (mt-52),
 * which the page's first card then replaced at its own height: the content
 * arrived from a different place than the eye was waiting at (#9135). The
 * skeleton is a card in the card's own frame and padding, so the first card
 * opens where it was drawn.
 *
 * A page whose first card is a table (a list of clusters, of hosts) draws
 * the table's header and rows in it instead of fields (shape "table"), so
 * its rows open where they were drawn (#9220).
 *
 * It says "Loading" to a screen reader, as the bar did.
 */

export type PageSkeletonShape = "fields" | "table" | "chart";

export interface ComponentProps {
  // What the page's first card holds: fields (the default), a table's rows or a chart.
  shape?: PageSkeletonShape | undefined;
}

export const PAGE_SKELETON_TEST_ID: string = "page-skeleton";

// The fields a skeleton card draws: enough to fill a card, not a page.
export const PAGE_SKELETON_FIELD_COUNT: number = 4;

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

const PageSkeleton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const fields: Array<ReactElement> = [];
  for (let index: number = 0; index < PAGE_SKELETON_FIELD_COUNT; index++) {
    fields.push(
      <div key={index} data-testid={`${PAGE_SKELETON_TEST_ID}-field`}>
        <div className="flex h-5 items-center">
          <div
            className={`h-3 ${NAME_WIDTH_CLASS_NAMES[index]} ${DETAIL_SKELETON_BAR_CLASS_NAME}`}
          />
        </div>
        <div className="mt-1 flex h-6 items-center">
          <div
            className={`h-3.5 ${VALUE_WIDTH_CLASS_NAMES[index]} ${DETAIL_SKELETON_BAR_CLASS_NAME}`}
          />
        </div>
      </div>,
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy={true}
      aria-label={translator.translateText("Loading")}
      data-testid={PAGE_SKELETON_TEST_ID}
      className="w-full min-w-0"
    >
      <div
        aria-hidden="true"
        className={`${CARD_FRAME_CLASS_NAME} ${CARD_PADDING_CLASS_NAME} motion-safe:animate-pulse`}
      >
        {/* The card's title and the line of description under it. */}
        <div className="flex h-6 items-center">
          <div className={`h-4 w-40 ${DETAIL_SKELETON_BAR_CLASS_NAME}`} />
        </div>
        <div className="mt-1 flex h-5 items-center">
          <div className={`h-3 w-72 ${DETAIL_SKELETON_BAR_CLASS_NAME}`} />
        </div>
        {props.shape === "chart" ? (
          <div className="mt-6" data-testid={`${PAGE_SKELETON_TEST_ID}-chart`}>
            <ChartSkeletonBars />
          </div>
        ) : props.shape === "table" ? (
          <div className="mt-6" data-testid={`${PAGE_SKELETON_TEST_ID}-table`}>
            <TableSkeletonBars />
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
            {fields}
          </div>
        )}
      </div>
      <span className="sr-only">{translator.translateText("Loading...")}</span>
    </div>
  );
};

export default PageSkeleton;
