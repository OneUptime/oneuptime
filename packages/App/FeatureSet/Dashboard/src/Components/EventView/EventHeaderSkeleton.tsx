import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import {
  EVENT_HEADER_BUTTONS_CLASS_NAME,
  EVENT_HEADER_CLASS_NAME,
  EVENT_HEADER_FACT_CLASS_NAME,
  EVENT_HEADER_PHONE_WIDTH_REM,
  EVENT_HEADER_TOP_SECTION_CLASS_NAME,
  EventHeaderTopRowClassNames,
  atContainerWidth,
  getEventHeaderActionsBesideWidth,
  getEventHeaderFactsClassName,
  getEventHeaderTopRowClassNames,
} from "./EventHeaderLayout";

export interface ComponentProps {
  testId: string;
  /*
   * Read to a screen reader while the header loads: "Loading incident
   * status". Left out where the page around it already says it loads (the
   * overview's own skeleton), so it is said once.
   */
  loadingText?: string | undefined;
  // How many buttons and facts the loaded header is likely to have.
  buttonCount?: number | undefined;
  factCount?: number | undefined;
}

type RangeFunction = (count: number) => Array<number>;

const range: RangeFunction = (count: number): Array<number> => {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return index;
  });
};

// Deterministic widths, so the placeholder never flickers on re-render.
const BUTTON_WIDTHS: Array<string> = ["w-32", "w-24", "w-36", "w-28"];
const VALUE_WIDTHS: Array<string> = ["w-20", "w-28", "w-32", "w-24", "w-28"];

/*
 * A button's place, sized as a loaded button is: on a phone's header it
 * grows from its width to share the row, wider it keeps its width. (No
 * fixed minimum: the placeholder holds nothing a phone could not fit.)
 */
const SKELETON_BUTTON_CLASS_NAME: string = `h-9 max-w-full flex-auto rounded-md bg-gray-100 ${atContainerWidth(
  EVENT_HEADER_PHONE_WIDTH_REM,
  "flex-none",
)}`;

/*
 * The buttons a header most often has, in order - an incident's and an
 * alert's - and the pills beside them, whose words the placeholder lays its
 * top row out by.
 */
export const EVENT_HEADER_SKELETON_BUTTON_LABELS: ReadonlyArray<string> = [
  translationKey("Acknowledge"),
  translationKey("Resolve"),
  translationKey("Declare Incident"),
  translationKey("Join call"),
];

// A state and a severity - a severity's name is the project's own.
export const EVENT_HEADER_SKELETON_PILLS: ReadonlyArray<string> = [
  translationKey("Created"),
  "SEV-2",
];

/*
 * The width from which the buttons sit beside the pills, worked out as the
 * loaded header works it out (getEventHeaderActionsBesideWidth) for that
 * many of the usual buttons, in the reader's words.
 */
export function getEventHeaderSkeletonBesideWidth(
  buttonCount: number,
  translate: (text: string) => string,
): number | null {
  return getEventHeaderActionsBesideWidth({
    identifier: "#1042",
    pills: EVENT_HEADER_SKELETON_PILLS.map(translate),
    actions: range(buttonCount).map((index: number) => {
      return {
        label: translate(
          EVENT_HEADER_SKELETON_BUTTON_LABELS[
            index % EVENT_HEADER_SKELETON_BUTTON_LABELS.length
          ]!,
        ),
        hasIcon: true,
      };
    }),
    hasMore: false,
  });
}

/*
 * Holds the header's place while its states and timeline load, drawn as the
 * loaded header is drawn (EventStatusPanel): the number and pills with the
 * buttons beside them, the title, the state track and the facts, on the same
 * card, laid out by the same width. Neither the swap from the page's
 * skeleton nor the swap to the real header moves the page.
 */
const EventHeaderSkeleton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const buttonCount: number = props.buttonCount ?? 2;
  const factCount: number = props.factCount ?? 4;
  const isStatus: boolean = Boolean(props.loadingText);
  const topRow: EventHeaderTopRowClassNames = getEventHeaderTopRowClassNames({
    besideWidthRem: getEventHeaderSkeletonBesideWidth(
      buttonCount,
      (text: string): string => {
        return translator.translateText(text) || text;
      },
    ),
    hasMore: false,
  });

  return (
    <div
      role={isStatus ? "status" : undefined}
      aria-live={isStatus ? "polite" : undefined}
      data-testid={props.testId}
      className={EVENT_HEADER_CLASS_NAME}
    >
      {props.loadingText ? (
        <span className="sr-only">
          {translator.translateText(props.loadingText)}
        </span>
      ) : (
        <></>
      )}
      <div aria-hidden="true" className="motion-safe:animate-pulse">
        <div className={EVENT_HEADER_TOP_SECTION_CLASS_NAME}>
          {/*
           * The loaded header's top row (getEventHeaderTopRowClassNames):
           * the pills, the title on a line of its own, and the buttons -
           * beside the pills from the width that many buttons need, under
           * the title below it, filling their row on a phone.
           */}
          <div className={topRow.row}>
            <div className={topRow.chips}>
              <div className="h-5 w-12 rounded-md bg-gray-100" />
              <div className="h-5 w-24 rounded-full bg-gray-100" />
              <div className="h-5 w-16 rounded-full bg-gray-100" />
            </div>
            <div className={topRow.title}>
              <div className="flex h-7 items-center">
                <div className="h-6 w-3/4 max-w-md rounded bg-gray-200" />
              </div>
            </div>
            {buttonCount > 0 ? (
              <div className={topRow.actions}>
                <div className={EVENT_HEADER_BUTTONS_CLASS_NAME}>
                  {range(buttonCount).map((button: number) => {
                    return (
                      <div
                        key={button}
                        className={`${SKELETON_BUTTON_CLASS_NAME} ${
                          BUTTON_WIDTHS[button % BUTTON_WIDTHS.length]
                        }`}
                      />
                    );
                  })}
                </div>
              </div>
            ) : (
              <></>
            )}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-1.5">
            {range(3).map((step: number) => {
              return (
                <div key={step}>
                  <div className="flex h-4 items-center">
                    <div className="h-3 w-16 max-w-full rounded bg-gray-100" />
                  </div>
                  <div className="mt-1.5 h-1 rounded-full bg-gray-100" />
                </div>
              );
            })}
          </div>
        </div>
        {factCount > 0 ? (
          <div className={getEventHeaderFactsClassName(factCount)}>
            {range(factCount).map((fact: number) => {
              /*
               * On the two rows a loaded fact spans, a line of a label's
               * height over a line of a value's, with the same space after
               * each.
               */
              return (
                <div key={fact} className={EVENT_HEADER_FACT_CLASS_NAME}>
                  <div className="self-end pb-1.5">
                    <div className="flex h-4 items-center">
                      <div className="h-3 w-24 max-w-full rounded bg-gray-100" />
                    </div>
                  </div>
                  <div className="pb-4">
                    <div
                      className={`h-5 max-w-full rounded bg-gray-100 ${
                        VALUE_WIDTHS[fact % VALUE_WIDTHS.length]
                      }`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

export default EventHeaderSkeleton;
