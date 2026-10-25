import React, { FunctionComponent, ReactElement } from "react";
import EventStatBar, { EventStatBarColumns } from "./EventStatBar";
import EventHeaderSkeleton from "./EventHeaderSkeleton";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

export interface ComponentProps {
  // How many cells the real stat bar under the hero has. Defaults to 3.
  statCount?: EventStatBarColumns | undefined;
  // Announced to screen readers, e.g. "Loading incident". Defaults to "Loading".
  loadingText?: string | undefined;
  className?: string | undefined;
}

type RangeFunction = (count: number) => Array<number>;

const range: RangeFunction = (count: number): Array<number> => {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return index;
  });
};

interface CardPlaceholderProps {
  lineCount: number;
  testId: string;
}

const CardPlaceholder: FunctionComponent<CardPlaceholderProps> = (
  props: CardPlaceholderProps,
): ReactElement => {
  // Deterministic ragged widths, so the placeholder does not flicker on re-render.
  const lineWidths: Array<string> = ["w-full", "w-5/6", "w-2/3", "w-3/4"];

  return (
    <div
      data-testid={props.testId}
      className="rounded-xl border border-gray-200 bg-white px-5 py-5 shadow-sm"
    >
      <div className="flex items-center gap-2.5">
        <div className="h-7 w-7 flex-shrink-0 rounded-lg bg-gray-100" />
        <div className="h-4 w-40 max-w-full rounded bg-gray-200" />
      </div>
      <div className="mt-5 space-y-3">
        {range(props.lineCount).map((line: number) => {
          return (
            <div
              key={line}
              className={`h-3 rounded bg-gray-100 ${
                lineWidths[line % lineWidths.length]
              }`}
            />
          );
        })}
      </div>
    </div>
  );
};

/*
 * First-load placeholder for the incident, alert, scheduled maintenance and
 * episode overview pages. It mirrors the loaded layout - header card, stat
 * bar, then a two-thirds / one-third grid of cards - so the page does not
 * jump when the data lands. Later refreshes keep the loaded page mounted
 * and never show this.
 */
const EventOverviewSkeleton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const statCount: EventStatBarColumns = props.statCount || 3;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`w-full ${props.className || ""}`}
    >
      <span className="sr-only">
        {translator.translateText(props.loadingText || "Loading")}
      </span>
      <div aria-hidden="true" className="space-y-5 motion-safe:animate-pulse">
        {/*
         * The header, as the header's own placeholder draws it. The page's
         * status above already says what loads, so it says nothing more.
         */}
        <EventHeaderSkeleton testId="event-overview-skeleton-hero" />

        <div data-testid="event-overview-skeleton-stats">
          <EventStatBar columns={statCount}>
            {range(statCount).map((cell: number) => {
              return (
                <div key={cell} className="min-w-0 bg-white px-5 py-4">
                  <div className="h-3 w-24 max-w-full rounded bg-gray-100" />
                  <div className="mt-2 h-6 w-20 max-w-full rounded bg-gray-200" />
                </div>
              );
            })}
          </EventStatBar>
        </div>

        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
          <div className="min-w-0 space-y-5 xl:col-span-2">
            <CardPlaceholder
              lineCount={4}
              testId="event-overview-skeleton-main-card"
            />
            <CardPlaceholder
              lineCount={3}
              testId="event-overview-skeleton-main-card"
            />
          </div>
          <div className="min-w-0 space-y-5">
            <CardPlaceholder
              lineCount={6}
              testId="event-overview-skeleton-side-card"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default EventOverviewSkeleton;
