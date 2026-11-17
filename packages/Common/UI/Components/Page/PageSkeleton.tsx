import { CARD_FRAME_CLASS_NAME, CARD_PADDING_CLASS_NAME } from "../Card/Card";
import { DETAIL_SKELETON_BAR_CLASS_NAME } from "../Detail/DetailSkeleton";
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
 * It says "Loading" to a screen reader, as the bar did.
 */

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

const PageSkeleton: FunctionComponent = (): ReactElement => {
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
        <div className="mt-6 grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
          {fields}
        </div>
      </div>
      <span className="sr-only">{translator.translateText("Loading...")}</span>
    </div>
  );
};

export default PageSkeleton;
