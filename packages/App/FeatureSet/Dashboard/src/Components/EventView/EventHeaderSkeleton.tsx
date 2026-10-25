import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import {
  EVENT_HEADER_CLASS_NAME,
  EVENT_HEADER_TOP_SECTION_CLASS_NAME,
  getEventHeaderFactsClassName,
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
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex h-9 items-center gap-2">
              <div className="h-5 w-12 rounded-md bg-gray-100" />
              <div className="h-5 w-24 rounded-full bg-gray-100" />
              <div className="h-5 w-16 rounded-full bg-gray-100" />
            </div>
            <div className="flex gap-2">
              {range(buttonCount).map((button: number) => {
                return (
                  <div
                    key={button}
                    className={`h-9 rounded-md bg-gray-100 ${
                      BUTTON_WIDTHS[button % BUTTON_WIDTHS.length]
                    }`}
                  />
                );
              })}
            </div>
          </div>
          <div className="mt-2 h-7 w-3/4 max-w-md rounded bg-gray-200" />
          <div className="mt-4 grid grid-cols-3 gap-1.5">
            {range(3).map((step: number) => {
              return (
                <div key={step}>
                  <div className="h-3 w-16 max-w-full rounded bg-gray-100" />
                  <div className="mt-2 h-1.5 rounded-full bg-gray-100" />
                </div>
              );
            })}
          </div>
        </div>
        {factCount > 0 ? (
          <div className={getEventHeaderFactsClassName(factCount)}>
            {range(factCount).map((fact: number) => {
              return (
                <div key={fact} className="min-w-0">
                  <div className="h-3 w-24 max-w-full rounded bg-gray-100" />
                  <div
                    className={`mt-2 h-5 max-w-full rounded bg-gray-100 ${
                      VALUE_WIDTHS[fact % VALUE_WIDTHS.length]
                    }`}
                  />
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
